// Demo students for WS2: a realistic spread across classes, guardians (some
// shared by siblings) and parent logins for the demo parent accounts.
import type { WriteBatch } from "firebase-admin/firestore";
import { col, db, now } from "./core.js";
import { DEMO } from "./seed.js";

const FIRST_M = ["Tunde", "Chidi", "Ibrahim", "Emeka", "Femi", "Musa", "Obinna", "Seun", "Kelechi", "Yusuf", "Dayo", "Ifeanyi", "Bola", "Sani", "Uche", "Kunle", "Nnamdi", "Abdul", "Tobi", "Gbenga"];
const FIRST_F = ["Amaka", "Funke", "Zainab", "Ngozi", "Bisi", "Aisha", "Chioma", "Kemi", "Halima", "Adaeze", "Yetunde", "Nkechi", "Fatima", "Folake", "Ijeoma", "Hauwa", "Titi", "Ebere", "Ronke", "Uju"];
const LAST = ["Adeyemi", "Okafor", "Bello", "Eze", "Ogunleye", "Abubakar", "Nwachukwu", "Balogun", "Okeke", "Danjuma", "Afolabi", "Onyeka", "Lawal", "Ibe", "Oladipo", "Garba", "Chukwu", "Akinola", "Umeh", "Salami"];
const GUARDIAN_TITLES = ["Mrs", "Mr", "Mrs", "Dr", "Mrs", "Mr"];

const ACADEMY_COUNTS: Record<string, number> = {
  "Primary 1": 6, "Primary 2": 6, "Primary 3": 6, "Primary 4": 6, "Primary 5": 6, "Primary 6": 6,
  "JSS 1": 10, "JSS 2": 7, "JSS 3": 6, "SS 1": 5, "SS 2": 5, "SS 3": 5,
};

type Arm = { id: string; levelId: string; levelName: string; name: string; order: number };

async function armsOf(sid: string): Promise<Arm[]> {
  const [levels, arms] = await Promise.all([col(sid, "classLevels").get(), col(sid, "classArms").get()]);
  const level = new Map(levels.docs.map((l) => [l.id, l.data()]));
  return arms.docs
    .map((a) => ({ id: a.id, levelId: a.data().levelId, levelName: level.get(a.data().levelId)?.name, name: a.data().name, order: level.get(a.data().levelId)?.order ?? 0 }))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

type Plan = {
  first: string;
  last: string;
  gender: "male" | "female";
  arm: Arm;
  guardianKey: string;
  guardian: { fullName: string; phone: string; email: string | null; uid: string | null; relationship: string };
  medical?: { allergies: string };
};

export async function seedDemoStudents() {
  const sessionId = "s2026";
  const academyArms = await armsOf(DEMO.academy);
  const plans: Plan[] = [];
  let n = 0;
  for (const arm of academyArms) {
    const count = ACADEMY_COUNTS[arm.levelName] ?? 0;
    for (let i = 0; i < count; i++, n++) {
      const female = n % 2 === 1;
      const first = (female ? FIRST_F : FIRST_M)[(n * 7) % 20];
      // Every 6th student is a younger sibling of the previous family (shared guardian).
      const family = n % 6 === 5 ? n - 1 : n;
      const last = LAST[(family * 3) % 20];
      plans.push({
        first,
        last,
        gender: female ? "female" : "male",
        arm,
        guardianKey: `fam${family}`,
        guardian: {
          fullName: `${GUARDIAN_TITLES[family % 6]} ${FIRST_F[(family * 11) % 20]} ${last}`,
          phone: `+234803${String(1000000 + family).slice(-7)}`,
          email: null,
          uid: null,
          relationship: family % 3 === 0 ? "Father" : "Mother",
        },
      });
    }
  }
  // The demo parent accounts' own children.
  const armNamed = (label: string) => academyArms.find((a) => `${a.levelName} ${a.name}` === label)!;
  const bisi = { fullName: "Mrs Bisi Lawal", phone: "+2348030000001", email: "parent1@demo.test", uid: "demo-parent1", relationship: "Mother" };
  plans.push({ first: "Tolu", last: "Lawal", gender: "male", arm: armNamed("JSS 1 A"), guardianKey: "bisi", guardian: bisi, medical: { allergies: "Peanuts (carries an EpiPen)" } });
  plans.push({ first: "Seyi", last: "Lawal", gender: "female", arm: armNamed("Primary 3 A"), guardianKey: "bisi", guardian: bisi });
  plans.push({ first: "Chiamaka", last: "Nwosu", gender: "female", arm: armNamed("JSS 1 B"), guardianKey: "emeka", guardian: { fullName: "Mr Emeka Nwosu", phone: "+2348030000002", email: "parent2@demo.test", uid: "demo-parent2", relationship: "Father" } });
  plans.push({ first: "Ada", last: "Obi", gender: "female", arm: armNamed("JSS 2 A"), guardianKey: "chinedu", guardian: { fullName: "Chinedu Obi", phone: "+2348030000003", email: "teacher2@demo.test", uid: "demo-teacher2", relationship: "Father" } });

  // A few Greenfield College students, to prove the schools stay separate.
  const gfArm = (await armsOf(DEMO.greenfield)).find((a) => a.levelName === "JSS 1" && a.name === "A");
  const gfPlans: Plan[] = gfArm
    ? Array.from({ length: 4 }, (_, i) => ({
        first: (i % 2 ? FIRST_F : FIRST_M)[i + 5],
        last: LAST[i + 10],
        gender: (i % 2 ? "female" : "male") as "male" | "female",
        arm: gfArm,
        guardianKey: `gf${i}`,
        guardian: { fullName: `Mrs ${FIRST_F[i]} ${LAST[i + 10]}`, phone: `+234809${String(2000000 + i).slice(-7)}`, email: null, uid: null, relationship: "Mother" },
      }))
    : [];

  let added = 0;
  for (const [sid, list, code] of [[DEMO.academy, plans, "WPZ"], [DEMO.greenfield, gfPlans, "GFC"]] as const) {
    // Never add demo students to a school that already has students.
    if (!(await col(sid, "students").limit(1).get()).empty) continue;
    added += list.length;
    const guardianIds = new Map<string, string>();
    const guardianStudents = new Map<string, string[]>();
    const counters: Record<string, number> = {};
    const ops: ((b: WriteBatch) => void)[] = [];
    type Ref = FirebaseFirestore.DocumentReference;
    type Data = FirebaseFirestore.DocumentData;
    const batch = {
      set: (ref: Ref, data: Data, opts?: FirebaseFirestore.SetOptions) => ops.push((b) => (opts ? b.set(ref, data, opts) : b.set(ref, data))),
      update: (ref: Ref, data: Data) => ops.push((b) => b.update(ref, data)),
    };
    for (const p of list) {
      let gid = guardianIds.get(p.guardianKey);
      if (!gid) {
        const gref = col(sid, "guardians").doc();
        gid = gref.id;
        guardianIds.set(p.guardianKey, gid);
        batch.set(gref, { fullName: p.guardian.fullName, phone: p.guardian.phone, whatsappPhone: p.guardian.phone, email: p.guardian.email, address: "Lekki, Lagos", occupation: null, uid: p.guardian.uid, studentIds: [], createdAt: now(), updatedAt: now() });
      }
      // Older classes were admitted in earlier years.
      const year = String(2026 - Math.max(0, Math.floor((p.arm.order % 100) - 1)));
      counters[year] = (counters[year] ?? 0) + 1;
      const admissionNo = `${code}/${year}/${String(counters[year]).padStart(4, "0")}`;
      const sref = col(sid, "students").doc();
      guardianStudents.set(gid, [...(guardianStudents.get(gid) ?? []), sref.id]);
      const age = (p.arm.order >= 300 ? 14 : p.arm.order >= 200 ? 11 : 5) + ((p.arm.order % 100) - 1);
      const data = {
        admissionNo,
        firstName: p.first,
        middleName: null,
        lastName: p.last,
        gender: p.gender,
        dateOfBirth: `${2026 - age}-${String((sref.id.charCodeAt(0) % 12) + 1).padStart(2, "0")}-${String((sref.id.charCodeAt(1) % 27) + 1).padStart(2, "0")}`,
        stateOfOrigin: "Lagos",
        lga: null,
        religion: null,
        admissionDate: `${year}-09-07`,
        status: "active",
        currentSessionId: sessionId,
        currentArmId: p.arm.id,
        currentLevelId: p.arm.levelId,
        guardians: [{ guardianId: gid, relationship: p.guardian.relationship, isPrimary: true, canPickup: true, receivesBilling: true }],
        guardianIds: [gid],
        parentUids: p.guardian.uid ? [p.guardian.uid] : [],
        hasMedicalAlert: Boolean(p.medical),
        hasPhoto: false,
        photoVersion: 0,
        withdrawal: null,
      };
      batch.set(sref, { ...data, searchKey: [p.first, p.last, admissionNo].join(" ").toLowerCase(), createdAt: now(), updatedAt: now() });
      batch.set(col(sid, "enrolments").doc(`${sessionId}__${sref.id}`), { studentId: sref.id, sessionId, armId: p.arm.id, levelId: p.arm.levelId, status: "active", startDate: "2026-09-07", endDate: null, createdAt: now() });
      if (p.medical) batch.set(col(sid, "studentMedical").doc(sref.id), { bloodGroup: "O+", genotype: "AA", allergies: p.medical.allergies, conditions: null, medications: "EpiPen", doctor: null, notes: null, updatedAt: now() });
    }
    for (const [gid, sids] of guardianStudents) batch.update(col(sid, "guardians").doc(gid), { studentIds: sids });
    batch.set(col(sid, "counters").doc("admission"), { byYear: counters }, { merge: true });
    for (let i = 0; i < ops.length; i += 400) {
      const b = db().batch();
      ops.slice(i, i + 400).forEach((op) => op(b));
      await b.commit();
    }
  }
  return { students: added };
}

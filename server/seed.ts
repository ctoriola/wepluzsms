// Demo data: two schools, one person per role, a full 2026/2027 calendar,
// classes, subjects, form tutors and teacher assignments.
// Every demo account uses the password Password123!  (DEMO ONLY)
import { applyTemplateTo } from "./actions/academics.js";
import { createSchoolDoc, DEFAULT_SETTINGS } from "./actions/people.js";
import { adminAuth, col, db, nameKey, now, schoolRef, type Role } from "./core.js";

export const DEMO_PASSWORD = "Password123!";
export const DEMO = { academy: "demo-academy", greenfield: "greenfield-college" } as const;

type Person = { uid: string; email: string; name: string; phone?: string; memberships: Record<string, Role[]>; platformAdmin?: boolean };

export const DEMO_PEOPLE: Person[] = [
  { uid: "demo-platform-admin", email: "admin@mandexa.test", name: "Platform Admin", memberships: {}, platformAdmin: true },
  { uid: "demo-proprietor", email: "proprietor@demo.test", name: "Adaeze Okafor", memberships: { [DEMO.academy]: ["proprietor"] } },
  { uid: "demo-principal", email: "principal@demo.test", name: "Tunde Bakare", memberships: { [DEMO.academy]: ["principal"] } },
  { uid: "demo-school-admin", email: "admin@demo.test", name: "Ngozi Eze", memberships: { [DEMO.academy]: ["school_admin"] } },
  { uid: "demo-bursar", email: "bursar@demo.test", name: "Ibrahim Musa", memberships: { [DEMO.academy]: ["bursar"] } },
  { uid: "demo-teacher1", email: "teacher1@demo.test", name: "Funmi Adeyemi", memberships: { [DEMO.academy]: ["teacher"] } },
  { uid: "demo-teacher2", email: "teacher2@demo.test", name: "Chinedu Obi", memberships: { [DEMO.academy]: ["teacher", "parent"] } },
  { uid: "demo-parent1", email: "parent1@demo.test", name: "Mrs Bisi Lawal", phone: "+2348030000001", memberships: { [DEMO.academy]: ["parent"] } },
  { uid: "demo-parent2", email: "parent2@demo.test", name: "Mr Emeka Nwosu", phone: "+2348030000002", memberships: { [DEMO.academy]: ["parent"] } },
  { uid: "gf-proprietor", email: "proprietor@greenfield.test", name: "Halima Yusuf", memberships: { [DEMO.greenfield]: ["proprietor"] } },
  { uid: "gf-teacher", email: "teacher@greenfield.test", name: "Segun Ojo", memberships: { [DEMO.greenfield]: ["teacher"] } },
];

async function createPeople() {
  for (const p of DEMO_PEOPLE) {
    await adminAuth()
      .createUser({ uid: p.uid, email: p.email, password: DEMO_PASSWORD, displayName: p.name, emailVerified: true, ...(p.phone ? { phoneNumber: p.phone } : {}) })
      .catch((err: { code?: string }) => {
        if (err.code !== "auth/uid-already-exists" && err.code !== "auth/email-already-exists") throw err;
      });
    if (p.platformAdmin) await adminAuth().setCustomUserClaims(p.uid, { platformAdmin: true });

    const batch = db().batch();
    const memberships: Record<string, { roles: Role[]; status: string }> = {};
    for (const [sid, roles] of Object.entries(p.memberships)) {
      memberships[sid] = { roles, status: "active" };
      batch.set(col(sid, "members").doc(p.uid), { uid: p.uid, fullName: p.name, email: p.email, phone: p.phone ?? null, roles, status: "active", createdAt: now(), updatedAt: now() });
    }
    batch.set(db().collection("users").doc(p.uid), {
      fullName: p.name,
      email: p.email,
      phone: p.phone ?? null,
      memberships,
      activeSchoolId: Object.keys(p.memberships)[0] ?? null,
      createdAt: now(),
    });
    await batch.commit();
  }
}

async function createCalendar(sid: string, sessionId: string, session: [string, string], terms: [string, string, string, string | null][]) {
  const batch = db().batch();
  batch.set(col(sid, "sessions").doc(sessionId), { name: "2026/2027", startDate: session[0], endDate: session[1], createdAt: now(), updatedAt: now() });
  terms.forEach(([name, start, end, next], i) => {
    batch.set(col(sid, "terms").doc(`${sessionId}-t${i + 1}`), { sessionId, termNumber: i + 1, name, startDate: start, endDate: end, nextTermBegins: next, createdAt: now(), updatedAt: now() });
  });
  batch.update(schoolRef(sid), { currentSessionId: sessionId, currentTermId: `${sessionId}-t1` });
  await batch.commit();
}

async function createArms(sid: string) {
  const levels = await col(sid, "classLevels").get();
  const batch = db().batch();
  const armIds: Record<string, string> = {};
  for (const l of levels.docs) {
    const names = l.data().section === "primary" ? ["A"] : ["A", "B"];
    for (const name of names) {
      const ref = col(sid, "classArms").doc();
      armIds[`${l.data().name} ${name}`] = ref.id;
      batch.set(ref, { levelId: l.id, name, nameKey: nameKey(name), formTutorId: null, capacity: 30, createdAt: now(), updatedAt: now() });
    }
  }
  await batch.commit();
  return armIds;
}

export async function seedDemo() {
  await createSchoolDoc({ name: "Wepluz Demo Academy", slug: "wepluz-demo", shortCode: "WPZ" }, null, DEMO.academy);
  await createSchoolDoc({ name: "Greenfield College", slug: "greenfield", shortCode: "GFC" }, null, DEMO.greenfield);
  await schoolRef(DEMO.academy).update({
    settings: { ...DEFAULT_SETTINGS, motto: "Excellence and Character", address: "12 Admiralty Way, Lekki Phase 1", city: "Lagos", state: "Lagos", phone: "+2348012345678", email: "info@demo.test" },
  });
  await schoolRef(DEMO.greenfield).update({ settings: { ...DEFAULT_SETTINGS, motto: "Knowledge is Light", city: "Abuja", state: "FCT", primaryColor: "#1B4332", accentColor: "#B7791F" } });

  await createPeople();

  await createCalendar(DEMO.academy, "s2026", ["2026-09-07", "2027-07-23"], [
    ["First Term", "2026-09-07", "2026-12-11", "2027-01-11"],
    ["Second Term", "2027-01-11", "2027-04-01", "2027-04-26"],
    ["Third Term", "2027-04-26", "2027-07-23", null],
  ]);
  await createCalendar(DEMO.greenfield, "s2026", ["2026-09-14", "2027-07-16"], [["First Term", "2026-09-14", "2026-12-18", "2027-01-11"]]);

  await applyTemplateTo(DEMO.academy, ["primary", "junior_secondary", "senior_secondary"], null);
  await applyTemplateTo(DEMO.greenfield, ["junior_secondary", "senior_secondary"], null);

  const arms = await createArms(DEMO.academy);
  await createArms(DEMO.greenfield);

  const subjects = await col(DEMO.academy, "subjects").get();
  const subjectId = (name: string) => subjects.docs.find((d) => d.data().name === name)!.id;
  const batch = db().batch();
  batch.update(col(DEMO.academy, "classArms").doc(arms["JSS 1 A"]), { formTutorId: "demo-teacher1" });
  batch.update(col(DEMO.academy, "classArms").doc(arms["JSS 1 B"]), { formTutorId: "demo-teacher2" });
  const assign: [string, string, string][] = [
    ["JSS 1 A", "Mathematics", "demo-teacher1"],
    ["JSS 1 B", "Mathematics", "demo-teacher1"],
    ["JSS 2 A", "Mathematics", "demo-teacher1"],
    ["JSS 1 A", "English Studies", "demo-teacher2"],
    ["JSS 1 B", "English Studies", "demo-teacher2"],
    ["JSS 1 A", "Basic Science", "demo-teacher2"],
  ];
  for (const [arm, subject, teacher] of assign) {
    const sub = subjectId(subject);
    batch.set(col(DEMO.academy, "assignments").doc(`s2026__${arms[arm]}__${sub}`), {
      sessionId: "s2026",
      armId: arms[arm],
      subjectId: sub,
      teacherId: teacher,
      createdAt: now(),
      updatedAt: now(),
    });
  }
  await batch.commit();
  return { ok: true };
}

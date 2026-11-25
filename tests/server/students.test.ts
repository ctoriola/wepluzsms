// WS2 student records: who can see which students (security rules), and the
// server rules for students, guardians, import, promotion and data upgrades.
import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminApp } from "../../server/core.js";
import { ACADEMY, call, GREENFIELD, installDemo, P, PROJECT, rejects } from "./helpers.js";

const db = () => getFirestore(adminApp());
const sch = (sid = ACADEMY) => db().collection("schools").doc(sid);
const p = (...parts: string[]) => [`schools/${ACADEMY}`, ...parts].join("/");

async function armId(label: string, sid = ACADEMY) {
  const [levelName, arm] = [label.slice(0, label.lastIndexOf(" ")), label.slice(label.lastIndexOf(" ") + 1)];
  const level = (await sch(sid).collection("classLevels").where("name", "==", levelName).get()).docs[0];
  return (await sch(sid).collection("classArms").where("levelId", "==", level.id).get()).docs.find((d) => d.data().name === arm)!.id;
}
async function studentNamed(first: string, last: string) {
  return (await sch().collection("students").where("firstName", "==", first).where("lastName", "==", last).get()).docs[0];
}

let env: RulesTestEnvironment;
const as = (uid: string) => env.authenticatedContext(uid).firestore();

beforeAll(async () => {
  await installDemo();
  env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8085 } });
});
afterAll(async () => {
  await env?.cleanup();
});

describe("who can see students (security rules)", () => {
  it("demo data: students, arm teacher lists, parent links", async () => {
    expect((await sch().collection("students").count().get()).data().count).toBeGreaterThan(100);
    const jss1a = (await sch().collection("classArms").doc(await armId("JSS 1 A")).get()).data()!;
    expect(jss1a.teacherIds).toEqual(expect.arrayContaining(["demo-teacher1", "demo-teacher2"]));
  });

  it("a teacher sees students in the arms they teach, and nobody else", async () => {
    const t = as("demo-teacher1");
    const mine = await assertSucceeds(getDocs(query(collection(t, p("students")), where("currentArmId", "==", await armId("JSS 1 A")))));
    expect(mine.size).toBe(11);
    await assertFails(getDocs(query(collection(t, p("students")), where("currentArmId", "==", await armId("Primary 1 A")))));
    await assertFails(getDocs(collection(t, p("students"))));
    const primary = (await sch().collection("students").where("currentArmId", "==", await armId("Primary 1 A")).limit(1).get()).docs[0];
    await assertFails(getDoc(doc(t, p("students", primary.id))));
  });

  it("teachers see the medical alert flag but never the medical details", async () => {
    const tolu = await studentNamed("Tolu", "Lawal");
    expect(tolu.data().hasMedicalAlert).toBe(true);
    await assertSucceeds(getDoc(doc(as("demo-teacher1"), p("students", tolu.id))));
    await assertFails(getDoc(doc(as("demo-teacher1"), p("studentMedical", tolu.id))));
    await assertFails(getDoc(doc(as("demo-bursar"), p("studentMedical", tolu.id))));
    await assertSucceeds(getDoc(doc(as("demo-school-admin"), p("studentMedical", tolu.id))));
  });

  it("a parent sees only their own children (and their medical details)", async () => {
    const par = as("demo-parent1");
    const kids = await assertSucceeds(getDocs(query(collection(par, p("students")), where("parentUids", "array-contains", "demo-parent1"))));
    expect(kids.docs.map((d) => d.data().firstName).sort()).toEqual(["Seyi", "Tolu"]);
    const tolu = await studentNamed("Tolu", "Lawal");
    await assertSucceeds(getDoc(doc(par, p("studentMedical", tolu.id))));
    const chiamaka = await studentNamed("Chiamaka", "Nwosu");
    await assertFails(getDoc(doc(par, p("students", chiamaka.id))));
    await assertFails(getDocs(collection(par, p("students"))));
    await assertFails(getDocs(collection(par, p("guardians"))));
    await assertSucceeds(getDocs(query(collection(par, p("guardians")), where("uid", "==", "demo-parent1"))));
  });

  it("a teacher who is also a parent sees their own child in another class", async () => {
    const ada = await studentNamed("Ada", "Obi");
    await assertSucceeds(getDoc(doc(as("demo-teacher2"), p("students", ada.id))));
  });

  it("the bursar sees every student; other schools see none", async () => {
    await assertSucceeds(getDocs(collection(as("demo-bursar"), p("students"))));
    await assertFails(getDocs(collection(as("gf-proprietor"), p("students"))));
    await assertFails(getDocs(collection(as("demo-teacher1"), p("guardians"))));
  });

  it("enrolments follow the same teacher rule", async () => {
    await assertSucceeds(getDocs(query(collection(as("demo-teacher1"), p("enrolments")), where("armId", "==", await armId("JSS 1 B")))));
    await assertFails(getDocs(query(collection(as("demo-teacher1"), p("enrolments")), where("armId", "==", await armId("SS 1 A")))));
  });
});

describe("students", () => {
  it("creates a student with the next admission number and a class enrolment", async () => {
    const arm = await armId("JSS 1 B");
    const out = await call(P.admin, "students.create", { schoolId: ACADEMY, firstName: "Kemi", lastName: "Ade", gender: "female", dateOfBirth: "2014-03-02", armId: arm, admissionDate: "2026-11-20" });
    expect(out.admissionNo).toMatch(/^WPZ\/2026\/\d{4}$/);
    const next = await call(P.admin, "students.create", { schoolId: ACADEMY, firstName: "Kunle", lastName: "Ade", gender: "male", armId: arm, admissionDate: "2026-11-20" });
    expect(Number(next.admissionNo.slice(-4))).toBe(Number(out.admissionNo.slice(-4)) + 1);
    const enrol = (await sch().collection("enrolments").doc(`s2026__${out.id}`).get()).data();
    expect(enrol).toMatchObject({ armId: arm, status: "active" });
  });

  it("rejects bad input, duplicate admission numbers and non-admins", async () => {
    const arm = await armId("JSS 1 B");
    await rejects(call(P.admin, "students.create", { schoolId: ACADEMY, firstName: "X1", lastName: "Y", gender: "male", armId: arm }), 400, "letters");
    await rejects(call(P.admin, "students.create", { schoolId: ACADEMY, firstName: "Ola", lastName: "Y", gender: "other", armId: arm }), 400, "male or female");
    await rejects(call(P.admin, "students.create", { schoolId: ACADEMY, firstName: "Ola", lastName: "Y", gender: "male", armId: arm, dateOfBirth: "2026-11-01", admissionDate: "2026-11-20" }), 400, "age");
    const used = (await studentNamed("Tolu", "Lawal")).data().admissionNo;
    await rejects(call(P.admin, "students.create", { schoolId: ACADEMY, firstName: "Ola", lastName: "Y", gender: "male", armId: arm, admissionNo: used }), 409, "already used");
    await rejects(call(P.teacher, "students.create", { schoolId: ACADEMY, firstName: "Ola", lastName: "Y", gender: "male", armId: arm }), 403);
    await rejects(call(P.bursar, "students.create", { schoolId: ACADEMY, firstName: "Ola", lastName: "Y", gender: "male", armId: arm }), 403);
  });

  it("blocks enrolment into a full arm", async () => {
    const arm = await armId("SS 3 B");
    await call(P.admin, "arms.update", { schoolId: ACADEMY, id: arm, name: "B", capacity: 5 });
    await rejects(call(P.admin, "students.create", { schoolId: ACADEMY, firstName: "Late", lastName: "Comer", gender: "male", armId: arm }), 409, "is full");
    await call(P.admin, "arms.update", { schoolId: ACADEMY, id: arm, name: "B", capacity: 30 });
  });

  it("changes class, withdraws and reinstates", async () => {
    const s = await studentNamed("Kemi", "Ade");
    const to = await armId("JSS 1 A");
    await call(P.admin, "students.changeArm", { schoolId: ACADEMY, studentId: s.id, armId: to });
    expect((await s.ref.get()).data()?.currentArmId).toBe(to);
    expect((await sch().collection("enrolments").doc(`s2026__${s.id}`).get()).data()?.armId).toBe(to);
    await rejects(call(P.admin, "students.withdraw", { schoolId: ACADEMY, studentId: s.id, date: "2026-11-25", reason: "" }), 400, "reason");
    await call(P.admin, "students.withdraw", { schoolId: ACADEMY, studentId: s.id, date: "2026-11-25", reason: "Relocated to Abuja" });
    expect((await s.ref.get()).data()).toMatchObject({ status: "withdrawn", currentArmId: null });
    await assertFails(getDoc(doc(as("demo-teacher1"), p("students", s.id)))); // gone from the teacher's view
    await call(P.admin, "students.reinstate", { schoolId: ACADEMY, studentId: s.id, armId: to });
    expect((await s.ref.get()).data()).toMatchObject({ status: "active", currentArmId: to });
  });

  it("medical details set the alert flag", async () => {
    const s = await studentNamed("Kunle", "Ade");
    await call(P.admin, "students.setMedical", { schoolId: ACADEMY, studentId: s.id, bloodGroup: "O+", genotype: "AS", allergies: "Penicillin" });
    expect((await s.ref.get()).data()?.hasMedicalAlert).toBe(true);
    await call(P.admin, "students.setMedical", { schoolId: ACADEMY, studentId: s.id, bloodGroup: "O+", genotype: "AS", allergies: "" });
    expect((await s.ref.get()).data()?.hasMedicalAlert).toBe(false);
  });
});

describe("guardians and parent logins", () => {
  it("reuses a guardian found by phone (siblings share one parent record)", async () => {
    const s = await studentNamed("Kunle", "Ade");
    const first = await call(P.admin, "guardians.add", { schoolId: ACADEMY, studentId: s.id, relationship: "Mother", guardian: { fullName: "Mrs Yemi Ade", phone: "0805 111 2222" } });
    expect(first.reused).toBe(false);
    const sib = await studentNamed("Kemi", "Ade");
    const second = await call(P.admin, "guardians.add", { schoolId: ACADEMY, studentId: sib.id, relationship: "Mother", guardian: { fullName: "Yemi Ade", phone: "+2348051112222" } });
    expect(second).toMatchObject({ reused: true, guardianId: first.guardianId });
    await rejects(call(P.admin, "guardians.add", { schoolId: ACADEMY, studentId: sib.id, relationship: "Mother", guardianId: first.guardianId }), 409, "already linked");
  });

  it("first guardian is primary; a guardian needs a phone or email", async () => {
    const s = (await studentNamed("Kunle", "Ade")).data()!;
    expect(s.guardians[0].isPrimary).toBe(true);
    await rejects(call(P.admin, "guardians.add", { schoolId: ACADEMY, studentId: (await studentNamed("Kunle", "Ade")).id, relationship: "Father", guardian: { fullName: "Mr Ade" } }), 400, "phone number or an email");
  });

  it("enabling a parent login lets that parent see all their children", async () => {
    const g = (await sch().collection("guardians").where("phone", "==", "+2348051112222").get()).docs[0];
    const { uid } = await call(P.admin, "guardians.enableLogin", { schoolId: ACADEMY, guardianId: g.id });
    expect((await sch().collection("members").doc(uid).get()).data()?.roles).toContain("parent");
    const kids = await assertSucceeds(getDocs(query(collection(as(uid), p("students")), where("parentUids", "array-contains", uid))));
    expect(kids.docs.map((d) => d.data().firstName).sort()).toEqual(["Kemi", "Kunle"]);
  });

  it("unlinking removes the parent's access to that child", async () => {
    const g = (await sch().collection("guardians").where("phone", "==", "+2348051112222").get()).docs[0];
    const kemi = await studentNamed("Kemi", "Ade");
    await call(P.admin, "guardians.unlink", { schoolId: ACADEMY, studentId: kemi.id, guardianId: g.id });
    await assertFails(getDoc(doc(as(g.data().uid), p("students", kemi.id))));
    expect((await g.ref.get()).data()?.studentIds).not.toContain(kemi.id);
  });
});

describe("bulk import", () => {
  const good = (over: Record<string, string> = {}) => ({ firstName: "amina", lastName: "bello", gender: "F", dateOfBirth: "12/04/2015", className: "Primary 6", guardianName: "Alhaji Bello", guardianPhone: "08036660001", relationship: "father", ...over });

  it("dry run reports every problem by spreadsheet row and saves nothing", async () => {
    const before = (await sch().collection("students").count().get()).data().count;
    const out = await call(P.admin, "students.import", {
      schoolId: ACADEMY,
      dryRun: true,
      rows: [
        good(),
        good({ className: "Primary 9" }),
        good({ gender: "x", dateOfBirth: "31/02/2015" }),
        good({ className: "JSS 1", arm: "" }),
        good({ guardianPhone: "123" }),
        good({ admissionNo: "IMP/1" }),
        good({ admissionNo: "imp/1" }),
      ],
    });
    expect(out.ok).toBe(false);
    const byRow = Object.fromEntries(out.errors.map((e: { row: number; messages: string[] }) => [e.row, e.messages.join(" ")]));
    expect(byRow[3]).toContain("does not exist");
    expect(byRow[4]).toMatch(/Gender/);
    expect(byRow[4]).toMatch(/not a valid date/);
    expect(byRow[5]).toMatch(/several arms/);
    expect(byRow[6]).toMatch(/not a valid number/);
    expect(byRow[8]).toMatch(/appears twice/);
    expect(byRow[2]).toBeUndefined();
    expect((await sch().collection("students").count().get()).data().count).toBe(before);
  });

  it("imports valid rows, generates admission numbers and shares guardians by phone", async () => {
    const out = await call(P.admin, "students.import", {
      schoolId: ACADEMY,
      dryRun: false,
      rows: [good(), good({ firstName: "musa", gender: "M", dateOfBirth: "2017-01-09", className: "Primary 4" }), good({ firstName: "zara", className: "JSS 2", arm: "b", guardianName: "Mrs Ruth Okon", guardianPhone: "08036660002", relationship: "" })],
    });
    expect(out).toMatchObject({ ok: true, saved: 3, guardiansCreated: 2, guardiansLinked: 1 });
    const amina = await studentNamed("Amina", "Bello");
    expect(amina.data()).toMatchObject({ gender: "female", dateOfBirth: "2015-04-12", status: "active" });
    expect(amina.data().admissionNo).toMatch(/^WPZ\/\d{4}\/\d{4}$/);
    const g = (await sch().collection("guardians").where("phone", "==", "+2348036660001").get()).docs[0];
    expect(g.data().studentIds).toHaveLength(2);
  });

  it("refuses an import that would overfill an arm", async () => {
    const arm = await armId("SS 2 A");
    await call(P.admin, "arms.update", { schoolId: ACADEMY, id: arm, name: "A", capacity: 6 });
    const out = await call(P.admin, "students.import", { schoolId: ACADEMY, dryRun: true, rows: [good({ className: "SS 2", arm: "A" }), good({ firstName: "b", className: "SS 2", arm: "A" })] });
    expect(out.errors[0].messages[0]).toMatch(/capacity is 6/);
    await call(P.admin, "arms.update", { schoolId: ACADEMY, id: arm, name: "A", capacity: 30 });
  });
});

describe("teacher lists stay in step", () => {
  it("assigning or removing a subject teacher updates who can see the class", async () => {
    const arm = await armId("Primary 1 A");
    const maths = (await sch().collection("subjects").where("name", "==", "Mathematics").get()).docs[0].id;
    await call(P.admin, "assignments.set", { schoolId: ACADEMY, armId: arm, subjectId: maths, teacherId: "demo-teacher1" });
    expect((await sch().collection("classArms").doc(arm).get()).data()?.teacherIds).toContain("demo-teacher1");
    await assertSucceeds(getDocs(query(collection(as("demo-teacher1"), p("students")), where("currentArmId", "==", arm))));
    await call(P.admin, "assignments.set", { schoolId: ACADEMY, armId: arm, subjectId: maths, teacherId: null });
    expect((await sch().collection("classArms").doc(arm).get()).data()?.teacherIds).not.toContain("demo-teacher1");
  });
});

describe("promotion to a new session", () => {
  beforeAll(installDemo);

  it("plans, runs once, and moves students when the new session starts", async () => {
    const { id: next } = await call(P.admin, "sessions.create", { schoolId: ACADEMY, name: "2027/2028", startDate: "2027-09-06", endDate: "2028-07-21" });
    const { id: term } = await call(P.admin, "terms.create", { schoolId: ACADEMY, sessionId: next, termNumber: 1, name: "First Term", startDate: "2027-09-06", endDate: "2027-12-10" });
    const tolu = await studentNamed("Tolu", "Lawal");
    const ss3 = (await sch().collection("students").where("currentArmId", "==", await armId("SS 3 A")).limit(1).get()).docs[0];
    const holdBack = (await sch().collection("students").where("currentArmId", "==", await armId("JSS 2 A")).limit(1).get()).docs[0];

    const plan = await call(P.admin, "promotion.run", { schoolId: ACADEMY, fromSessionId: "s2026", toSessionId: next, dryRun: true, exceptions: { [holdBack.id]: "repeat" } });
    expect(plan.saved).toBe(false);
    expect(plan.graduate).toBe(10); // SS 3 A + B
    expect(plan.repeat).toBe(1);
    expect(plan.moves).toEqual(expect.arrayContaining([expect.objectContaining({ from: "JSS 1", to: "JSS 2 A" }), expect.objectContaining({ from: "Primary 6", to: "JSS 1 A" })]));
    expect((await sch().collection("enrolments").doc(`${next}__${tolu.id}`).get()).exists).toBe(false);

    await rejects(call(P.teacher, "promotion.run", { schoolId: ACADEMY, fromSessionId: "s2026", toSessionId: next, dryRun: false }), 403);
    const run = await call(P.admin, "promotion.run", { schoolId: ACADEMY, fromSessionId: "s2026", toSessionId: next, dryRun: false, exceptions: { [holdBack.id]: "repeat" } });
    expect(run.saved).toBe(true);
    expect((await sch().collection("enrolments").doc(`${next}__${tolu.id}`).get()).data()).toMatchObject({ armId: await armId("JSS 2 A"), status: "active" });
    // Nothing changes for this session yet: leavers stay active until the new session starts.
    expect((await ss3.ref.get()).data()?.status).toBe("active");
    expect((await sch().collection("enrolments").doc(`s2026__${tolu.id}`).get()).data()).toMatchObject({ status: "active", outcome: "promoted" });
    expect((await sch().collection("enrolments").doc(`s2026__${holdBack.id}`).get()).data()?.outcome).toBe("repeated");
    expect((await sch().collection("enrolments").doc(`${next}__${holdBack.id}`).get()).data()?.levelId).toBe((await holdBack.ref.get()).data()?.currentLevelId);
    // Students stay in this year's classes until the school moves to the new session.
    expect((await tolu.ref.get()).data()?.currentArmId).toBe(await armId("JSS 1 A"));

    const again = await call(P.admin, "promotion.run", { schoolId: ACADEMY, fromSessionId: "s2026", toSessionId: next, dryRun: false });
    expect(again).toMatchObject({ promote: 0, repeat: 0, graduate: 0 }); // nothing is moved twice

    await call(P.admin, "calendar.setCurrentTerm", { schoolId: ACADEMY, termId: term });
    expect((await tolu.ref.get()).data()).toMatchObject({ currentSessionId: next, currentArmId: await armId("JSS 2 A") });
    expect((await holdBack.ref.get()).data()).toMatchObject({ currentSessionId: next, currentArmId: await armId("JSS 2 A") }); // kept back
    expect((await ss3.ref.get()).data()).toMatchObject({ status: "graduated", currentArmId: null });
    expect((await sch().collection("enrolments").doc(`s2026__${tolu.id}`).get()).data()?.status).toBe("promoted");
    const promoted = (await sch().collection("students").where("firstName", "==", "Chiamaka").get()).docs[0];
    expect(promoted.data()).toMatchObject({ currentSessionId: next, currentArmId: await armId("JSS 2 B") });
    // New session has no subject teachers yet, so only form tutors remain on arm teacher lists.
    expect((await sch().collection("classArms").doc(await armId("JSS 1 B")).get()).data()?.teacherIds).toEqual(["demo-teacher2"]);
  });

  it("rejects promoting backwards in time", async () => {
    const sessions = await sch().collection("sessions").where("name", "==", "2027/2028").get();
    await rejects(call(P.admin, "promotion.run", { schoolId: ACADEMY, fromSessionId: sessions.docs[0].id, toSessionId: "s2026", dryRun: true }), 400, "must start after");
  });
});

describe("data upgrade for existing installs", () => {
  beforeAll(installDemo);
  it("rebuilds arm teacher lists and adds demo students to an old demo install", async () => {
    // Simulate a site installed before WS2.
    await db().doc("platform/config").set({ dataVersion: 1 }, { merge: true });
    for (const a of (await sch().collection("classArms").get()).docs) await a.ref.update({ teacherIds: [] });
    for (const s of (await sch().collection("students").get()).docs) await s.ref.delete();
    for (const s of (await sch(GREENFIELD).collection("students").get()).docs) await s.ref.delete();
    expect((await call(null, "setup.status")).dataVersion).toBe(1);
    await rejects(call(P.proprietor, "setup.upgrade"), 403);
    const out = await call(P.platform, "setup.upgrade");
    expect(out.done.join(" ")).toMatch(/demo students/);
    expect((await sch().collection("classArms").doc(await armId("JSS 1 A")).get()).data()?.teacherIds).toContain("demo-teacher1");
    expect((await sch().collection("students").count().get()).data().count).toBeGreaterThan(100);
    expect((await call(null, "setup.status")).dataVersion).toBe(3);
    expect((await call(P.platform, "setup.upgrade")).done).toEqual([]);
  });
});

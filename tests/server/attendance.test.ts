// WS3 attendance: who can take registers, date rules, absence alert queue,
// student summaries and who can read registers.
import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc } from "firebase/firestore";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminApp } from "../../server/core.js";
import { ACADEMY, call, installDemo, P, PROJECT, rejects, TODAY } from "./helpers.js";

const db = () => getFirestore(adminApp());
const sch = () => db().collection("schools").doc(ACADEMY);
let env: RulesTestEnvironment;
let armId = "";
let students: { id: string; parentUids: string[] }[] = [];
const allPresent = () => Object.fromEntries(students.map((s) => [s.id, "present"]));

beforeAll(async () => {
  await installDemo();
  env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8085 } });
  const level = (await sch().collection("classLevels").where("name", "==", "JSS 3").get()).docs[0];
  armId = (await sch().collection("classArms").where("levelId", "==", level.id).get()).docs.find((a) => a.data().name === "A")!.id;
  // Funmi becomes JSS 3 A's form tutor for these tests.
  await call(P.admin, "arms.update", { schoolId: ACADEMY, id: armId, name: "A", formTutorId: "demo-teacher1", capacity: 30 });
  students = (await sch().collection("students").where("currentArmId", "==", armId).get()).docs.map((d) => ({ id: d.id, parentUids: d.data().parentUids }));
});
afterAll(async () => {
  await env?.cleanup();
});

describe("taking the register", () => {
  it("the form tutor takes today's register; absences are queued for parent alerts", async () => {
    const marks = { ...allPresent(), [students[0].id]: "absent", [students[1].id]: "late" };
    const out = await call(P.teacher, "attendance.save", { schoolId: ACADEMY, armId, date: TODAY, marks });
    expect(out).toMatchObject({ ok: true, alertsQueued: 1, counts: { absent: 1, late: 1, present: students.length - 2 } });
    const alert = (await sch().collection("outbox").doc(`absence__${TODAY}__${students[0].id}`).get()).data();
    expect(alert).toMatchObject({ type: "absence", status: "pending" });
  });

  it("re-saving does not queue the same alert twice; correcting an absence cancels it", async () => {
    const again = await call(P.teacher, "attendance.save", { schoolId: ACADEMY, armId, date: TODAY, marks: { ...allPresent(), [students[0].id]: "absent" } });
    expect(again.alertsQueued).toBe(0);
    await call(P.teacher, "attendance.save", { schoolId: ACADEMY, armId, date: TODAY, marks: allPresent() });
    expect((await sch().collection("outbox").doc(`absence__${TODAY}__${students[0].id}`).get()).data()?.status).toBe("cancelled");
  });

  it("every student must be marked, and only students of this class", async () => {
    const partial = { ...allPresent() };
    delete partial[students[0].id];
    await rejects(call(P.teacher, "attendance.save", { schoolId: ACADEMY, armId, date: TODAY, marks: partial }), 400, "mark every student");
    await rejects(call(P.teacher, "attendance.save", { schoolId: ACADEMY, armId, date: TODAY, marks: { ...allPresent(), "someone-else": "present" } }), 400, "not in this class");
    await rejects(call(P.teacher, "attendance.save", { schoolId: ACADEMY, armId, date: TODAY, marks: { ...allPresent(), [students[0].id]: "sleeping" } }), 400);
  });

  it("date rules: no future days, weekends, days outside the term or holidays", async () => {
    await rejects(call(P.admin, "attendance.save", { schoolId: ACADEMY, armId, date: "2026-11-26", marks: allPresent() }), 400, "future");
    await rejects(call(P.admin, "attendance.save", { schoolId: ACADEMY, armId, date: "2026-11-22", marks: allPresent() }), 400, "weekend");
    await rejects(call(P.admin, "attendance.save", { schoolId: ACADEMY, armId, date: "2026-09-01", marks: allPresent() }), 400, "outside");
    await call(P.admin, "attendance.setHoliday", { schoolId: ACADEMY, date: "2026-10-01", label: "Independence Day" });
    await rejects(call(P.admin, "attendance.save", { schoolId: ACADEMY, armId, date: "2026-10-01", marks: allPresent() }), 400, "Independence Day");
  });

  it("tutors only take today's register; admins can correct earlier days", async () => {
    await rejects(call(P.teacher, "attendance.save", { schoolId: ACADEMY, armId, date: "2026-11-24", marks: allPresent() }), 403, "today");
    await call(P.admin, "attendance.save", { schoolId: ACADEMY, armId, date: "2026-11-24", marks: { ...allPresent(), [students[2].id]: "absent" } });
  });

  it("only the form tutor or an admin can take a class register", async () => {
    await rejects(call(P.dual, "attendance.save", { schoolId: ACADEMY, armId, date: TODAY, marks: allPresent() }), 403, "form tutor");
    await rejects(call(P.bursar, "attendance.save", { schoolId: ACADEMY, armId, date: TODAY, marks: allPresent() }), 403);
    await rejects(call(P.parent, "attendance.save", { schoolId: ACADEMY, armId, date: TODAY, marks: allPresent() }), 403);
    await rejects(call(P.gfProprietor, "attendance.save", { schoolId: ACADEMY, armId, date: TODAY, marks: allPresent() }), 403);
  });
});

describe("attendance summaries and access", () => {
  it("summarises a student's term", async () => {
    const s = await call(P.admin, "attendance.studentSummary", { schoolId: ACADEMY, studentId: students[2].id });
    expect(s).toMatchObject({ term: "First Term", marked: 2, absent: 1, present: 1 });
    expect(s.daysOpen).toBeGreaterThan(50);
    expect(s.records[0]).toEqual({ date: "2026-11-24", status: "absent" });
    expect(s.rate).toBe(50);
  });

  it("parents see their own child's summary only", async () => {
    const tolu = (await sch().collection("students").where("firstName", "==", "Tolu").get()).docs[0];
    const mine = await call(P.parent, "attendance.studentSummary", { schoolId: ACADEMY, studentId: tolu.id });
    expect(mine.marked).toBeGreaterThan(0); // demo history
    await rejects(call(P.parent, "attendance.studentSummary", { schoolId: ACADEMY, studentId: students[0].id }), 403);
  });

  it("registers are readable by the class's teachers and leadership, not by parents or other teachers", async () => {
    const path = `schools/${ACADEMY}/attendance/${armId}__${TODAY}`;
    await assertSucceeds(getDoc(doc(env.authenticatedContext("demo-teacher1").firestore(), path)));
    await assertSucceeds(getDoc(doc(env.authenticatedContext("demo-bursar").firestore(), path)));
    await assertFails(getDoc(doc(env.authenticatedContext("demo-teacher2").firestore(), path)));
    // A register not taken yet: the class's teacher may check (it simply does not exist); others may not.
    await assertSucceeds(getDoc(doc(env.authenticatedContext("demo-teacher1").firestore(), `schools/${ACADEMY}/attendance/${armId}__2026-11-20`)));
    await assertFails(getDoc(doc(env.authenticatedContext("demo-teacher2").firestore(), `schools/${ACADEMY}/attendance/${armId}__2026-11-20`)));
    await assertFails(getDoc(doc(env.authenticatedContext("demo-parent1").firestore(), path)));
    await assertFails(getDoc(doc(env.authenticatedContext("demo-teacher1").firestore(), `schools/${ACADEMY}/outbox/absence__${TODAY}__${students[0].id}`)));
  });

  it("demo history exists for the demo classes", async () => {
    expect((await sch().collection("attendance").count().get()).data().count).toBeGreaterThanOrEqual(40);
  });
});

// Keeps derived fields in step with the source data. Run after bulk changes
// (session switch, promotion, data upgrades). Uses batched writes, so it works
// for schools with thousands of students.
import { col, db, schoolRef } from "./core.js";

const BATCH = 400;

async function commitInBatches(writes: ((b: FirebaseFirestore.WriteBatch) => void)[]) {
  for (let i = 0; i < writes.length; i += BATCH) {
    const batch = db().batch();
    writes.slice(i, i + BATCH).forEach((w) => w(batch));
    await batch.commit();
  }
}

/** arm.teacherIds = form tutor + everyone teaching a subject in that arm this session. Read by the security rules. */
export function armTeachers(formTutorId: string | null | undefined, assignmentTeacherIds: string[]) {
  return [...new Set([...(formTutorId ? [formTutorId] : []), ...assignmentTeacherIds])].sort();
}

export async function recomputeArmTeachers(sid: string) {
  const sessionId = ((await schoolRef(sid).get()).data()?.currentSessionId as string | null) ?? null;
  const [arms, assigns] = await Promise.all([
    col(sid, "classArms").get(),
    sessionId ? col(sid, "assignments").where("sessionId", "==", sessionId).get() : Promise.resolve(null),
  ]);
  const byArm = new Map<string, string[]>();
  for (const a of assigns?.docs ?? []) byArm.set(a.data().armId, [...(byArm.get(a.data().armId) ?? []), a.data().teacherId]);
  const writes = arms.docs
    .map((arm) => ({ arm, teacherIds: armTeachers(arm.data().formTutorId, byArm.get(arm.id) ?? []) }))
    .filter(({ arm, teacherIds }) => JSON.stringify(arm.data().teacherIds ?? null) !== JSON.stringify(teacherIds))
    .map(({ arm, teacherIds }) => (b: FirebaseFirestore.WriteBatch) => b.update(arm.ref, { teacherIds }));
  await commitInBatches(writes);
  return writes.length;
}

/**
 * Move the school to `sessionId`: close earlier sessions' enrolments that have a
 * promotion outcome, graduate leavers, and point every active student at their
 * class for the new session (or no class if they have no enrolment there).
 */
export async function syncStudentsToSession(sid: string, sessionId: string) {
  const [enrolments, openEnrolments, students] = await Promise.all([
    col(sid, "enrolments").where("sessionId", "==", sessionId).get(),
    col(sid, "enrolments").where("status", "==", "active").get(),
    col(sid, "students").where("status", "==", "active").get(),
  ]);
  const byStudent = new Map(enrolments.docs.filter((e) => e.data().status === "active").map((e) => [e.data().studentId as string, e.data()]));
  const closing = openEnrolments.docs.filter((e) => e.data().sessionId !== sessionId && e.data().outcome);
  const graduating = new Set(closing.filter((e) => e.data().outcome === "graduated").map((e) => e.data().studentId as string));

  const writes: ((b: FirebaseFirestore.WriteBatch) => void)[] = closing.map((e) => (b) => b.update(e.ref, { status: e.data().outcome }));
  for (const s of students.docs) {
    const e = byStudent.get(s.id);
    const d = s.data();
    if (!e && graduating.has(s.id)) {
      writes.push((b) => b.update(s.ref, { status: "graduated", currentSessionId: sessionId, currentArmId: null, currentLevelId: null }));
      continue;
    }
    const next = { currentSessionId: sessionId, currentArmId: e?.armId ?? null, currentLevelId: e?.levelId ?? null };
    if (d.currentSessionId !== next.currentSessionId || d.currentArmId !== next.currentArmId || d.currentLevelId !== next.currentLevelId) {
      writes.push((b) => b.update(s.ref, next));
    }
  }
  await commitInBatches(writes);
  return writes.length;
}

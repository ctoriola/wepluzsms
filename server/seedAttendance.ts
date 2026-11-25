// Demo attendance: the last 10 school days (before today) for a few classes,
// so attendance summaries have something to show. Today is left unmarked so
// the demo form tutor can take today's register.
import { col, db, now } from "./core.js";
import { lagosToday, schoolDays } from "./actions/attendance.js";
import { DEMO } from "./seed.js";

const CLASSES = ["JSS 1 A", "JSS 1 B", "JSS 2 A", "Primary 3 A"];

function hash(s: string) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

export async function seedDemoAttendance(today = lagosToday()) {
  const sid = DEMO.academy;
  const school = (await db().collection("schools").doc(sid).get()).data();
  if (!school?.currentTermId) return { registers: 0 };
  const term = (await col(sid, "terms").doc(school.currentTermId).get()).data() as { name: string; startDate: string; endDate: string; sessionId: string };
  if (!(await col(sid, "attendance").limit(1).get()).empty) return { registers: 0 };
  const days = schoolDays({ id: school.currentTermId, ...term }, today).filter((d) => d < today).slice(-10);

  const [levels, arms] = await Promise.all([col(sid, "classLevels").get(), col(sid, "classArms").get()]);
  const levelName = new Map(levels.docs.map((l) => [l.id, l.data().name as string]));
  const batch = db().batch();
  let registers = 0;
  for (const arm of arms.docs.filter((a) => CLASSES.includes(`${levelName.get(a.data().levelId)} ${a.data().name}`))) {
    const students = await col(sid, "students").where("currentArmId", "==", arm.id).where("status", "==", "active").get();
    for (const d of days) {
      const marks: Record<string, string> = {};
      for (const s of students.docs) {
        const h = hash(`${s.id}${d}`);
        marks[s.id] = h % 19 === 0 ? "absent" : h % 11 === 0 ? "late" : "present";
      }
      const counts = { present: 0, absent: 0, late: 0, excused: 0 } as Record<string, number>;
      Object.values(marks).forEach((m) => counts[m]++);
      batch.set(col(sid, "attendance").doc(`${arm.id}__${d}`), {
        armId: arm.id,
        levelId: arm.data().levelId,
        termId: school.currentTermId,
        sessionId: term.sessionId,
        date: d,
        marks,
        notes: {},
        counts,
        markedBy: arm.data().formTutorId ?? "demo-school-admin",
        markedAt: now(),
        createdAt: now(),
      });
      registers++;
    }
  }
  await batch.commit();
  return { registers };
}

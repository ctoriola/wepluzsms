// WS3 Attendance: one register per class arm per school day.
// Form tutors mark today's register; admins can mark or correct any school day
// in the current term. Absences are queued (outbox) for parent alerts (WS6).
import { type DocumentData } from "firebase-admin/firestore";
import { z } from "zod";
import { ADMIN_ROLES, audit, col, db, fail, getOrFail, now, parse, requireRole, schoolRef, STAFF_ROLES, type Ctx, type Role } from "../core.js";
import type { Deps } from "./public.js";

const id = z.string().min(1).max(128);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.");
const STATUS = ["present", "absent", "late", "excused"] as const;
type Status = (typeof STATUS)[number];

/** Today's date in Nigeria (YYYY-MM-DD). */
export const lagosToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });

const weekday = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay(); // 0 Sun ... 6 Sat
const isWeekend = (d: string) => [0, 6].includes(weekday(d));

type Term = { id: string; name: string; startDate: string; endDate: string; holidays?: { date: string; label: string }[] };

async function currentTerm(sid: string): Promise<Term & { sessionId: string }> {
  const school = (await schoolRef(sid).get()).data();
  if (!school?.currentTermId) fail(400, "Set the current term first (Sessions & terms).");
  return getOrFail<Term & { sessionId: string }>(col(sid, "terms").doc(school!.currentTermId), "Term");
}

/** Every school day of the term from its start up to `until` (inclusive): weekdays that are not holidays. */
export function schoolDays(term: Term, until: string) {
  const holidays = new Set((term.holidays ?? []).map((h) => h.date));
  const days: string[] = [];
  const end = until < term.endDate ? until : term.endDate;
  for (let t = Date.parse(`${term.startDate}T12:00:00Z`); t <= Date.parse(`${end}T12:00:00Z`); t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (!isWeekend(d) && !holidays.has(d)) days.push(d);
  }
  return days;
}

function checkSchoolDay(term: Term, d: string, today: string) {
  if (d > today) fail(400, "You cannot take a register for a future date.");
  if (d < term.startDate || d > term.endDate) fail(400, `That date is outside ${term.name} (${term.startDate} to ${term.endDate}).`);
  if (isWeekend(d)) fail(400, "That date is a weekend.");
  const holiday = term.holidays?.find((h) => h.date === d);
  if (holiday) fail(400, `That date is a school holiday (${holiday.label}).`);
}

export async function attendanceSave(input: unknown, ctx: Ctx | null, deps: Deps) {
  const v = parse(
    z.object({
      schoolId: id,
      armId: id,
      date,
      marks: z.record(z.string(), z.enum(STATUS)),
      notes: z.record(z.string(), z.string().max(200)).optional(),
    }),
    input,
  );
  const { ctx: c, roles } = await requireRole(ctx, v.schoolId, STAFF_ROLES);
  const isAdmin = c.platformAdmin || roles.some((r: Role) => ADMIN_ROLES.includes(r));
  const today = deps.today();
  const term = await currentTerm(v.schoolId);
  checkSchoolDay(term, v.date, today);

  const arm = await getOrFail<{ formTutorId?: string | null; levelId: string; name: string }>(col(v.schoolId, "classArms").doc(v.armId), "Class");
  if (!isAdmin && arm.formTutorId !== c.uid) fail(403, "Only this class's form tutor (or a school admin) can take its register.");
  if (!isAdmin && v.date !== today) fail(403, "Form tutors can only take today's register. Ask a school admin to correct earlier days.");

  // The register must cover exactly the class's active students.
  const students = await col(v.schoolId, "students").where("currentArmId", "==", v.armId).where("status", "==", "active").get();
  const expected = new Set(students.docs.map((s) => s.id));
  const given = Object.keys(v.marks);
  if (given.some((sid) => !expected.has(sid))) fail(400, "The register includes a student who is not in this class. Reload the page and try again.");
  const missing = [...expected].filter((sid) => !v.marks[sid]);
  if (missing.length) fail(400, `Mark every student (${missing.length} not marked). Reload the page if the class list changed.`);

  const ref = col(v.schoolId, "attendance").doc(`${v.armId}__${v.date}`);
  return db().runTransaction(async (tx) => {
    const before = (await tx.get(ref)).data() as DocumentData | undefined;
    const counts = Object.fromEntries(STATUS.map((s) => [s, given.filter((k) => v.marks[k] === s).length])) as Record<Status, number>;
    tx.set(ref, {
      armId: v.armId,
      levelId: arm.levelId,
      termId: term.id,
      sessionId: term.sessionId,
      date: v.date,
      marks: v.marks,
      notes: v.notes ?? {},
      counts,
      markedBy: c.uid,
      markedAt: now(),
      ...(before ? {} : { createdAt: now() }),
    });
    // Queue a parent alert for each newly absent student (sent by WS6 messaging).
    const newlyAbsent = given.filter((k) => v.marks[k] === "absent" && before?.marks?.[k] !== "absent");
    for (const studentId of newlyAbsent) {
      tx.set(col(v.schoolId, "outbox").doc(`absence__${v.date}__${studentId}`), { type: "absence", studentId, armId: v.armId, date: v.date, status: "pending", createdAt: now() });
    }
    // If a student was wrongly marked absent and is corrected, cancel the pending alert.
    for (const studentId of given.filter((k) => before?.marks?.[k] === "absent" && v.marks[k] !== "absent")) {
      tx.set(col(v.schoolId, "outbox").doc(`absence__${v.date}__${studentId}`), { status: "cancelled", updatedAt: now() }, { merge: true });
    }
    audit(tx, v.schoolId, c, {
      action: before ? "update" : "create",
      entity: "attendance",
      entityId: ref.id,
      before: before ? { counts: before.counts } : null,
      after: { counts, date: v.date },
    });
    return { ok: true, counts, alertsQueued: newlyAbsent.length };
  });
}

export async function attendanceSetHoliday(input: unknown, ctx: Ctx | null) {
  const v = parse(z.object({ schoolId: id, date, label: z.string().trim().max(60).nullable() }), input);
  const { ctx: c } = await requireRole(ctx, v.schoolId, ADMIN_ROLES);
  const term = await currentTerm(v.schoolId);
  if (v.date < term.startDate || v.date > term.endDate) fail(400, "That date is outside the current term.");
  const ref = col(v.schoolId, "terms").doc(term.id);
  const others = (term.holidays ?? []).filter((h) => h.date !== v.date);
  const holidays = v.label ? [...others, { date: v.date, label: v.label }].sort((a, b) => a.date.localeCompare(b.date)) : others;
  const batch = db().batch();
  batch.update(ref, { holidays, updatedAt: now() });
  audit(batch, v.schoolId, c, { action: "update", entity: "holiday", entityId: `${term.id}:${v.date}`, before: { holidays: term.holidays ?? [] }, after: { holidays } });
  await batch.commit();
  return { ok: true, holidays };
}

/** A student's attendance this term. Leadership/bursar, the class's teachers, or the child's own parents. */
export async function attendanceStudentSummary(input: unknown, ctx: Ctx | null, deps: Deps) {
  const v = parse(z.object({ schoolId: id, studentId: id }), input);
  const { ctx: c, roles } = await requireRole(ctx, v.schoolId, ["proprietor", "principal", "school_admin", "bursar", "teacher", "parent"]);
  const student = await getOrFail<{ currentArmId: string | null; parentUids?: string[]; firstName: string }>(col(v.schoolId, "students").doc(v.studentId), "Student");
  const seesAll = c.platformAdmin || roles.some((r) => ["proprietor", "principal", "school_admin", "bursar"].includes(r));
  const isParent = (student.parentUids ?? []).includes(c.uid);
  let teaches = false;
  if (!seesAll && !isParent && student.currentArmId && roles.includes("teacher")) {
    const arm = (await col(v.schoolId, "classArms").doc(student.currentArmId).get()).data();
    teaches = ((arm?.teacherIds ?? []) as string[]).includes(c.uid);
  }
  if (!seesAll && !isParent && !teaches) fail(403, "You do not have access to this student's attendance.");

  const term = await currentTerm(v.schoolId);
  const days = schoolDays(term, deps.today());
  const registers = student.currentArmId ? await col(v.schoolId, "attendance").where("armId", "==", student.currentArmId).get() : null;
  const byDate = new Map((registers?.docs ?? []).filter((r) => r.data().termId === term.id).map((r) => [r.data().date as string, r.data()]));
  const records = days.map((d) => ({ date: d, status: (byDate.get(d)?.marks?.[v.studentId] as Status | undefined) ?? null }));
  const count = (s: Status) => records.filter((r) => r.status === s).length;
  const marked = records.filter((r) => r.status).length;
  const attended = count("present") + count("late");
  return {
    term: term.name,
    daysOpen: days.length,
    marked,
    present: count("present"),
    late: count("late"),
    absent: count("absent"),
    excused: count("excused"),
    rate: marked ? Math.round((attended / (marked - count("excused") || 1)) * 1000) / 10 : null,
    records: records.filter((r) => r.status && r.status !== "present").reverse(),
  };
}

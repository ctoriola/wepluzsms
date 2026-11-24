// WS1 academic structure: sessions, terms, class levels, arms, subjects,
// subjects per class, teacher assignments and the Nigerian template.
// Every rule the SQL version enforced is enforced here, inside transactions.
import { FieldValue, type Transaction } from "firebase-admin/firestore";
import { z } from "zod";
import { audit, col, db, fail, getOrFail, nameKey, now, parse, requireRole, schoolRef, ADMIN_ROLES, TEACHING_ROLES, type Ctx, type Role } from "../core.js";
import { armTeachers, recomputeArmTeachers, syncStudentsToSession } from "../sync.js";
import { SECTION_BASE, SECTIONS, TEMPLATE_LEVELS, TEMPLATE_SUBJECTS, type Section } from "../template.js";

const id = z.string().min(1).max(128);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.");
const sectionSchema = z.enum(["nursery", "primary", "junior_secondary", "senior_secondary"]);
const categorySchema = z.enum(["core", "science", "arts", "commercial", "trade", "language", "religious", "vocational", "early_years", "other"]);

const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;

async function admin(ctx: Ctx | null, schoolId: string) {
  return (await requireRole(ctx, schoolId, ADMIN_ROLES)).ctx;
}

async function isTeachingStaff(tx: Transaction, sid: string, uid: string) {
  const m = await tx.get(col(sid, "members").doc(uid));
  const d = m.data();
  return Boolean(d && d.status === "active" && (d.roles as Role[]).some((r) => TEACHING_ROLES.includes(r)));
}

// ------------------------------------------------------------------ sessions
const sessionInput = z.object({
  schoolId: id,
  name: z.string().regex(/^\d{4}\/\d{4}$/, "Write the session like 2026/2027."),
  startDate: date,
  endDate: date,
});

async function checkSession(tx: Transaction, sid: string, v: z.infer<typeof sessionInput>, selfId?: string) {
  if (v.endDate <= v.startDate) fail(400, "The session must end after it starts.");
  if (days(v.startDate, v.endDate) > 400) fail(400, "A session cannot be longer than about a year.");
  const same = await tx.get(col(sid, "sessions").where("name", "==", v.name));
  if (same.docs.some((d) => d.id !== selfId)) fail(409, "That session already exists.");
  if (selfId) {
    const terms = await tx.get(col(sid, "terms").where("sessionId", "==", selfId));
    if (terms.docs.some((t) => t.data().startDate < v.startDate || t.data().endDate > v.endDate)) {
      fail(400, "A term in this session falls outside the new dates. Adjust the term first.");
    }
  }
}

export async function sessionsCreate(input: unknown, ctx: Ctx | null) {
  const v = parse(sessionInput, input);
  const c = await admin(ctx, v.schoolId);
  return db().runTransaction(async (tx) => {
    await checkSession(tx, v.schoolId, v);
    const ref = col(v.schoolId, "sessions").doc();
    const data = { name: v.name, startDate: v.startDate, endDate: v.endDate };
    tx.set(ref, { ...data, createdAt: now(), updatedAt: now() });
    audit(tx, v.schoolId, c, { action: "create", entity: "session", entityId: ref.id, after: data });
    return { id: ref.id };
  });
}

export async function sessionsUpdate(input: unknown, ctx: Ctx | null) {
  const v = parse(sessionInput.extend({ id }), input);
  const c = await admin(ctx, v.schoolId);
  return db().runTransaction(async (tx) => {
    const ref = col(v.schoolId, "sessions").doc(v.id);
    const before = await getOrFail(ref, "Session", tx);
    await checkSession(tx, v.schoolId, v, v.id);
    const data = { name: v.name, startDate: v.startDate, endDate: v.endDate };
    tx.update(ref, { ...data, updatedAt: now() });
    audit(tx, v.schoolId, c, { action: "update", entity: "session", entityId: v.id, before, after: { ...before, ...data } });
    return { ok: true };
  });
}

export async function sessionsDelete(input: unknown, ctx: Ctx | null) {
  const v = parse(z.object({ schoolId: id, id }), input);
  const c = await admin(ctx, v.schoolId);
  return db().runTransaction(async (tx) => {
    const ref = col(v.schoolId, "sessions").doc(v.id);
    const before = await getOrFail(ref, "Session", tx);
    const terms = await tx.get(col(v.schoolId, "terms").where("sessionId", "==", v.id).limit(1));
    if (!terms.empty) fail(409, "This session has terms. Delete the terms first.");
    const assigned = await tx.get(col(v.schoolId, "assignments").where("sessionId", "==", v.id).limit(1));
    if (!assigned.empty) fail(409, "Teachers are assigned in this session, so it cannot be deleted.");
    tx.delete(ref);
    audit(tx, v.schoolId, c, { action: "delete", entity: "session", entityId: v.id, before });
    return { ok: true };
  });
}

// ------------------------------------------------------------------ terms
const termInput = z.object({
  schoolId: id,
  sessionId: id,
  termNumber: z.number().int().min(1).max(3),
  name: z.string().trim().min(2, "Enter the term name.").max(50),
  startDate: date,
  endDate: date,
  nextTermBegins: date.nullable().optional(),
});

async function checkTerm(tx: Transaction, sid: string, v: z.infer<typeof termInput>, selfId?: string) {
  if (v.endDate <= v.startDate) fail(400, "The term must end after it starts.");
  if (v.nextTermBegins && v.nextTermBegins <= v.endDate) fail(400, "'Next term begins' must be after this term ends.");
  const session = await getOrFail<{ startDate: string; endDate: string }>(col(sid, "sessions").doc(v.sessionId), "Session", tx);
  if (v.startDate < session.startDate || v.endDate > session.endDate) {
    fail(400, `Term dates must fall within the session (${session.startDate} to ${session.endDate}).`);
  }
  const siblings = (await tx.get(col(sid, "terms").where("sessionId", "==", v.sessionId))).docs.filter((d) => d.id !== selfId);
  if (siblings.some((d) => d.data().termNumber === v.termNumber)) fail(409, `This session already has term ${v.termNumber}.`);
  if (siblings.some((d) => d.data().startDate <= v.endDate && v.startDate <= d.data().endDate)) fail(400, "Term dates overlap another term in this session.");
}

export async function termsCreate(input: unknown, ctx: Ctx | null) {
  const v = parse(termInput, input);
  const c = await admin(ctx, v.schoolId);
  return db().runTransaction(async (tx) => {
    await checkTerm(tx, v.schoolId, v);
    const ref = col(v.schoolId, "terms").doc();
    const data = { sessionId: v.sessionId, termNumber: v.termNumber, name: v.name, startDate: v.startDate, endDate: v.endDate, nextTermBegins: v.nextTermBegins ?? null };
    tx.set(ref, { ...data, createdAt: now(), updatedAt: now() });
    audit(tx, v.schoolId, c, { action: "create", entity: "term", entityId: ref.id, after: data });
    return { id: ref.id };
  });
}

export async function termsUpdate(input: unknown, ctx: Ctx | null) {
  const v = parse(termInput.omit({ sessionId: true, termNumber: true }).extend({ id }), input);
  const c = await admin(ctx, v.schoolId);
  return db().runTransaction(async (tx) => {
    const ref = col(v.schoolId, "terms").doc(v.id);
    const before = await getOrFail<{ sessionId: string; termNumber: number }>(ref, "Term", tx);
    await checkTerm(tx, v.schoolId, { ...v, sessionId: before.sessionId, termNumber: before.termNumber }, v.id);
    const data = { name: v.name, startDate: v.startDate, endDate: v.endDate, nextTermBegins: v.nextTermBegins ?? null };
    tx.update(ref, { ...data, updatedAt: now() });
    audit(tx, v.schoolId, c, { action: "update", entity: "term", entityId: v.id, before, after: { ...before, ...data } });
    return { ok: true };
  });
}

export async function termsDelete(input: unknown, ctx: Ctx | null) {
  const v = parse(z.object({ schoolId: id, id }), input);
  const c = await admin(ctx, v.schoolId);
  return db().runTransaction(async (tx) => {
    const school = await tx.get(schoolRef(v.schoolId));
    if (school.data()?.currentTermId === v.id) fail(409, "This is the current term. Make another term current first.");
    const ref = col(v.schoolId, "terms").doc(v.id);
    const before = await getOrFail(ref, "Term", tx);
    tx.delete(ref);
    audit(tx, v.schoolId, c, { action: "delete", entity: "term", entityId: v.id, before });
    return { ok: true };
  });
}

/** One current term per school, by design: it is a single field on the school. */
export async function setCurrentTerm(input: unknown, ctx: Ctx | null) {
  const v = parse(z.object({ schoolId: id, termId: id }), input);
  const c = await admin(ctx, v.schoolId);
  const result = await db().runTransaction(async (tx) => {
    const term = await getOrFail<{ sessionId: string }>(col(v.schoolId, "terms").doc(v.termId), "Term", tx);
    const school = (await tx.get(schoolRef(v.schoolId))).data() ?? {};
    tx.update(schoolRef(v.schoolId), { currentTermId: v.termId, currentSessionId: term.sessionId, updatedAt: now() });
    audit(tx, v.schoolId, c, {
      action: "update",
      entity: "calendar",
      entityId: v.schoolId,
      before: { currentTermId: school.currentTermId ?? null, currentSessionId: school.currentSessionId ?? null },
      after: { currentTermId: v.termId, currentSessionId: term.sessionId },
    });
    return { sessionChanged: school.currentSessionId !== term.sessionId, sessionId: term.sessionId };
  });
  // A new session means new class lists and new teacher assignments.
  if (result.sessionChanged) {
    await syncStudentsToSession(v.schoolId, result.sessionId);
    await recomputeArmTeachers(v.schoolId);
  }
  return { ok: true };
}

// ------------------------------------------------------------------ class levels
const levelInput = z.object({ schoolId: id, name: z.string().trim().min(1, "Enter the class name, e.g. JSS 1.").max(50), section: sectionSchema });

async function assertUniqueLevel(tx: Transaction, sid: string, name: string, selfId?: string) {
  const same = await tx.get(col(sid, "classLevels").where("nameKey", "==", nameKey(name)));
  if (same.docs.some((d) => d.id !== selfId)) fail(409, "A class with that name already exists.");
}

export async function levelsCreate(input: unknown, ctx: Ctx | null) {
  const v = parse(levelInput, input);
  const c = await admin(ctx, v.schoolId);
  return db().runTransaction(async (tx) => {
    await assertUniqueLevel(tx, v.schoolId, v.name);
    const inSection = await tx.get(col(v.schoolId, "classLevels").where("section", "==", v.section));
    const order = Math.max(SECTION_BASE[v.section], ...inSection.docs.map((d) => d.data().order as number)) + 1;
    const ref = col(v.schoolId, "classLevels").doc();
    const data = { name: v.name, nameKey: nameKey(v.name), section: v.section, order, subjects: {} };
    tx.set(ref, { ...data, createdAt: now(), updatedAt: now() });
    audit(tx, v.schoolId, c, { action: "create", entity: "classLevel", entityId: ref.id, after: data });
    return { id: ref.id };
  });
}

export async function levelsUpdate(input: unknown, ctx: Ctx | null) {
  const v = parse(levelInput.extend({ id }), input);
  const c = await admin(ctx, v.schoolId);
  return db().runTransaction(async (tx) => {
    const ref = col(v.schoolId, "classLevels").doc(v.id);
    const before = await getOrFail(ref, "Class", tx);
    await assertUniqueLevel(tx, v.schoolId, v.name, v.id);
    const data = { name: v.name, nameKey: nameKey(v.name), section: v.section };
    tx.update(ref, { ...data, updatedAt: now() });
    audit(tx, v.schoolId, c, { action: "update", entity: "classLevel", entityId: v.id, before, after: { ...before, ...data } });
    return { ok: true };
  });
}

export async function levelsDelete(input: unknown, ctx: Ctx | null) {
  const v = parse(z.object({ schoolId: id, id }), input);
  const c = await admin(ctx, v.schoolId);
  return db().runTransaction(async (tx) => {
    const ref = col(v.schoolId, "classLevels").doc(v.id);
    const before = await getOrFail(ref, "Class", tx);
    const arms = await tx.get(col(v.schoolId, "classArms").where("levelId", "==", v.id).limit(1));
    if (!arms.empty) fail(409, "This class has arms. Delete the arms first.");
    tx.delete(ref);
    audit(tx, v.schoolId, c, { action: "delete", entity: "classLevel", entityId: v.id, before });
    return { ok: true };
  });
}

export async function levelsMove(input: unknown, ctx: Ctx | null) {
  const v = parse(z.object({ schoolId: id, id, direction: z.union([z.literal(-1), z.literal(1)]) }), input);
  const c = await admin(ctx, v.schoolId);
  return db().runTransaction(async (tx) => {
    const level = await getOrFail<{ section: Section; order: number }>(col(v.schoolId, "classLevels").doc(v.id), "Class", tx);
    const siblings = (await tx.get(col(v.schoolId, "classLevels").where("section", "==", level.section))).docs
      .map((d) => ({ id: d.id, order: d.data().order as number, name: d.data().name as string }))
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    const i = siblings.findIndex((s) => s.id === v.id);
    const other = siblings[i + v.direction];
    if (!other) return { ok: true };
    const newOrder = other.order === level.order ? other.order + v.direction : other.order;
    tx.update(col(v.schoolId, "classLevels").doc(v.id), { order: newOrder, updatedAt: now() });
    tx.update(col(v.schoolId, "classLevels").doc(other.id), { order: level.order, updatedAt: now() });
    audit(tx, v.schoolId, c, { action: "update", entity: "classLevel", entityId: v.id, before: { order: level.order }, after: { order: newOrder } });
    return { ok: true };
  });
}

/** Offer a subject in a class level: compulsory, elective, or not at all. */
export async function levelsSetSubject(input: unknown, ctx: Ctx | null) {
  const v = parse(z.object({ schoolId: id, levelId: id, subjectId: id, state: z.enum(["none", "compulsory", "elective"]) }), input);
  const c = await admin(ctx, v.schoolId);
  return db().runTransaction(async (tx) => {
    const ref = col(v.schoolId, "classLevels").doc(v.levelId);
    const level = await getOrFail<{ subjects?: Record<string, string> }>(ref, "Class", tx);
    await getOrFail(col(v.schoolId, "subjects").doc(v.subjectId), "Subject", tx);
    const previous = level.subjects?.[v.subjectId] ?? "none";
    if (v.state === "none" && previous !== "none") {
      const arms = await tx.get(col(v.schoolId, "classArms").where("levelId", "==", v.levelId));
      const armIds = new Set(arms.docs.map((a) => a.id));
      const assigned = await tx.get(col(v.schoolId, "assignments").where("subjectId", "==", v.subjectId));
      if (assigned.docs.some((a) => armIds.has(a.data().armId))) {
        fail(409, "Teachers are assigned to this subject in this class. Remove those assignments first.");
      }
    }
    tx.update(ref, { [`subjects.${v.subjectId}`]: v.state === "none" ? FieldValue.delete() : v.state, updatedAt: now() });
    audit(tx, v.schoolId, c, { action: "update", entity: "classSubject", entityId: `${v.levelId}:${v.subjectId}`, before: { state: previous }, after: { state: v.state } });
    return { ok: true };
  });
}

// ------------------------------------------------------------------ arms
const armInput = z.object({
  schoolId: id,
  name: z.string().trim().min(1, "Enter the arm name, e.g. A or Gold.").max(30),
  formTutorId: z.string().max(128).nullable().optional(),
  capacity: z.number().int().min(1, "Capacity must be between 1 and 200.").max(200, "Capacity must be between 1 and 200.").nullable().optional(),
});

async function checkArm(tx: Transaction, sid: string, levelId: string, v: z.infer<typeof armInput>, selfId?: string) {
  const same = await tx.get(col(sid, "classArms").where("levelId", "==", levelId));
  if (same.docs.some((d) => d.id !== selfId && d.data().nameKey === nameKey(v.name))) fail(409, "This class already has an arm with that name.");
  if (v.formTutorId && !(await isTeachingStaff(tx, sid, v.formTutorId))) fail(400, "The form tutor must be a teacher at this school.");
}

export async function armsCreate(input: unknown, ctx: Ctx | null) {
  const v = parse(armInput.extend({ levelId: id }), input);
  const c = await admin(ctx, v.schoolId);
  return db().runTransaction(async (tx) => {
    await getOrFail(col(v.schoolId, "classLevels").doc(v.levelId), "Class", tx);
    await checkArm(tx, v.schoolId, v.levelId, v);
    const ref = col(v.schoolId, "classArms").doc();
    const data = { levelId: v.levelId, name: v.name, nameKey: nameKey(v.name), formTutorId: v.formTutorId || null, capacity: v.capacity ?? null };
    tx.set(ref, { ...data, teacherIds: armTeachers(data.formTutorId, []), createdAt: now(), updatedAt: now() });
    audit(tx, v.schoolId, c, { action: "create", entity: "classArm", entityId: ref.id, after: data });
    return { id: ref.id };
  });
}

export async function armsUpdate(input: unknown, ctx: Ctx | null) {
  const v = parse(armInput.extend({ id }), input);
  const c = await admin(ctx, v.schoolId);
  return db().runTransaction(async (tx) => {
    const ref = col(v.schoolId, "classArms").doc(v.id);
    const before = await getOrFail<{ levelId: string }>(ref, "Class arm", tx);
    await checkArm(tx, v.schoolId, before.levelId, v, v.id);
    const sessionId = (await tx.get(schoolRef(v.schoolId))).data()?.currentSessionId as string | undefined;
    const assigned = await tx.get(col(v.schoolId, "assignments").where("armId", "==", v.id));
    const teachers = assigned.docs.filter((a) => a.data().sessionId === sessionId).map((a) => a.data().teacherId as string);
    const data = { name: v.name, nameKey: nameKey(v.name), formTutorId: v.formTutorId || null, capacity: v.capacity ?? null };
    tx.update(ref, { ...data, teacherIds: armTeachers(data.formTutorId, teachers), updatedAt: now() });
    audit(tx, v.schoolId, c, { action: "update", entity: "classArm", entityId: v.id, before, after: { ...before, ...data } });
    return { ok: true };
  });
}

export async function armsDelete(input: unknown, ctx: Ctx | null) {
  const v = parse(z.object({ schoolId: id, id }), input);
  const c = await admin(ctx, v.schoolId);
  return db().runTransaction(async (tx) => {
    const ref = col(v.schoolId, "classArms").doc(v.id);
    const before = await getOrFail(ref, "Class arm", tx);
    const assigned = await tx.get(col(v.schoolId, "assignments").where("armId", "==", v.id).limit(1));
    if (!assigned.empty) fail(409, "Teachers are assigned to this arm. Remove those assignments first.");
    const enrolled = await tx.get(col(v.schoolId, "enrolments").where("armId", "==", v.id).limit(1));
    if (!enrolled.empty) fail(409, "Students are (or were) in this arm, so it cannot be deleted.");
    tx.delete(ref);
    audit(tx, v.schoolId, c, { action: "delete", entity: "classArm", entityId: v.id, before });
    return { ok: true };
  });
}

// ------------------------------------------------------------------ subjects
const subjectInput = z.object({
  schoolId: id,
  name: z.string().trim().min(2, "Enter the subject name.").max(100),
  shortCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,8}$/, "Code must be 2-8 letters or numbers, e.g. MTH."),
  category: categorySchema,
});

async function checkSubject(tx: Transaction, sid: string, v: z.infer<typeof subjectInput>, selfId?: string) {
  const [byName, byCode] = await Promise.all([
    tx.get(col(sid, "subjects").where("nameKey", "==", nameKey(v.name))),
    tx.get(col(sid, "subjects").where("shortCode", "==", v.shortCode)),
  ]);
  if (byName.docs.some((d) => d.id !== selfId)) fail(409, "A subject with that name already exists.");
  if (byCode.docs.some((d) => d.id !== selfId)) fail(409, "Another subject already uses that code.");
}

export async function subjectsCreate(input: unknown, ctx: Ctx | null) {
  const v = parse(subjectInput, input);
  const c = await admin(ctx, v.schoolId);
  return db().runTransaction(async (tx) => {
    await checkSubject(tx, v.schoolId, v);
    const ref = col(v.schoolId, "subjects").doc();
    const data = { name: v.name, nameKey: nameKey(v.name), shortCode: v.shortCode, category: v.category };
    tx.set(ref, { ...data, createdAt: now(), updatedAt: now() });
    audit(tx, v.schoolId, c, { action: "create", entity: "subject", entityId: ref.id, after: data });
    return { id: ref.id };
  });
}

export async function subjectsUpdate(input: unknown, ctx: Ctx | null) {
  const v = parse(subjectInput.extend({ id }), input);
  const c = await admin(ctx, v.schoolId);
  return db().runTransaction(async (tx) => {
    const ref = col(v.schoolId, "subjects").doc(v.id);
    const before = await getOrFail(ref, "Subject", tx);
    await checkSubject(tx, v.schoolId, v, v.id);
    const data = { name: v.name, nameKey: nameKey(v.name), shortCode: v.shortCode, category: v.category };
    tx.update(ref, { ...data, updatedAt: now() });
    audit(tx, v.schoolId, c, { action: "update", entity: "subject", entityId: v.id, before, after: { ...before, ...data } });
    return { ok: true };
  });
}

export async function subjectsDelete(input: unknown, ctx: Ctx | null) {
  const v = parse(z.object({ schoolId: id, id }), input);
  const c = await admin(ctx, v.schoolId);
  return db().runTransaction(async (tx) => {
    const ref = col(v.schoolId, "subjects").doc(v.id);
    const before = await getOrFail(ref, "Subject", tx);
    const levels = await tx.get(col(v.schoolId, "classLevels"));
    if (levels.docs.some((l) => l.data().subjects?.[v.id])) fail(409, "This subject is still offered in some classes. Untick it in 'Subjects by class' first.");
    const assigned = await tx.get(col(v.schoolId, "assignments").where("subjectId", "==", v.id).limit(1));
    if (!assigned.empty) fail(409, "Teachers are assigned to this subject.");
    tx.delete(ref);
    audit(tx, v.schoolId, c, { action: "delete", entity: "subject", entityId: v.id, before });
    return { ok: true };
  });
}

// ------------------------------------------------------------------ teacher assignments
/** Set (or clear, with teacherId null) who teaches a subject in an arm for the current session. */
export async function assignmentsSet(input: unknown, ctx: Ctx | null) {
  const v = parse(z.object({ schoolId: id, armId: id, subjectId: id, teacherId: z.string().max(128).nullable() }), input);
  const c = await admin(ctx, v.schoolId);
  return db().runTransaction(async (tx) => {
    const school = (await tx.get(schoolRef(v.schoolId))).data();
    const sessionId = school?.currentSessionId as string | undefined;
    if (!sessionId) fail(400, "Set the current term first (Sessions & terms).");
    const arm = await getOrFail<{ levelId: string; formTutorId?: string | null }>(col(v.schoolId, "classArms").doc(v.armId), "Class arm", tx);
    const level = await getOrFail<{ subjects?: Record<string, string> }>(col(v.schoolId, "classLevels").doc(arm.levelId), "Class", tx);
    if (!level.subjects?.[v.subjectId]) fail(400, "This subject is not offered in this class. Add it under Subjects first.");
    if (v.teacherId && !(await isTeachingStaff(tx, v.schoolId, v.teacherId))) fail(400, "The teacher must be a teacher at this school.");
    // One teacher per subject per arm per session, guaranteed by the document id.
    const ref = col(v.schoolId, "assignments").doc(`${sessionId}__${v.armId}__${v.subjectId}`);
    const existing = await tx.get(ref);
    const before = existing.exists ? existing.data() : null;
    // Keep the arm's teacher list (used by the security rules) in step.
    const armAssigned = await tx.get(col(v.schoolId, "assignments").where("armId", "==", v.armId));
    const others = armAssigned.docs.filter((a) => a.id !== ref.id && a.data().sessionId === sessionId).map((a) => a.data().teacherId as string);
    tx.update(col(v.schoolId, "classArms").doc(v.armId), { teacherIds: armTeachers(arm.formTutorId, v.teacherId ? [...others, v.teacherId] : others) });
    if (!v.teacherId) {
      if (existing.exists) {
        tx.delete(ref);
        audit(tx, v.schoolId, c, { action: "delete", entity: "assignment", entityId: ref.id, before });
      }
      return { ok: true };
    }
    const data = { sessionId, armId: v.armId, subjectId: v.subjectId, teacherId: v.teacherId };
    tx.set(ref, { ...data, updatedAt: now(), ...(existing.exists ? {} : { createdAt: now() }) }, { merge: true });
    audit(tx, v.schoolId, c, { action: existing.exists ? "update" : "create", entity: "assignment", entityId: ref.id, before, after: data });
    return { ok: true };
  });
}

// ------------------------------------------------------------------ template
export async function applyTemplate(input: unknown, ctx: Ctx | null) {
  const v = parse(z.object({ schoolId: id, sections: z.array(sectionSchema).min(1, "Choose at least one section.") }), input);
  const c = ctx ? await admin(ctx, v.schoolId) : null;
  return applyTemplateTo(v.schoolId, v.sections, c);
}

/** Also used by the demo seed (ctx null = system). Safe to run repeatedly. */
export async function applyTemplateTo(sid: string, sections: Section[], c: Ctx | null) {
  return db().runTransaction(async (tx) => {
    const [levelSnap, subjectSnap] = await Promise.all([tx.get(col(sid, "classLevels")), tx.get(col(sid, "subjects"))]);
    const levels = new Map(levelSnap.docs.map((d) => [d.data().nameKey as string, { id: d.id, subjects: { ...(d.data().subjects ?? {}) } as Record<string, string>, isNew: false }]));
    const subjectsByName = new Map(subjectSnap.docs.map((d) => [d.data().nameKey as string, d.id]));
    const codes = new Set(subjectSnap.docs.map((d) => d.data().shortCode as string));
    let levelsAdded = 0, subjectsAdded = 0, offeringsAdded = 0;

    for (const section of SECTIONS.filter((s) => sections.includes(s))) {
      for (const [name, code, category] of TEMPLATE_SUBJECTS[section]) {
        const key = nameKey(name);
        if (subjectsByName.has(key) || codes.has(code)) continue;
        const ref = col(sid, "subjects").doc();
        const data = { name, nameKey: key, shortCode: code, category };
        tx.set(ref, { ...data, createdAt: now(), updatedAt: now() });
        audit(tx, sid, c, { action: "create", entity: "subject", entityId: ref.id, after: data });
        subjectsByName.set(key, ref.id);
        codes.add(code);
        subjectsAdded++;
      }
      TEMPLATE_LEVELS[section].forEach((name, i) => {
        const key = nameKey(name);
        let level = levels.get(key);
        if (!level) {
          level = { id: col(sid, "classLevels").doc().id, subjects: {}, isNew: true };
          levels.set(key, level);
          levelsAdded++;
          audit(tx, sid, c, { action: "create", entity: "classLevel", entityId: level.id, after: { name, section } });
        }
        for (const [sname, , , compulsory] of TEMPLATE_SUBJECTS[section]) {
          const sidOf = subjectsByName.get(nameKey(sname));
          if (sidOf && !level.subjects[sidOf]) {
            level.subjects[sidOf] = compulsory ? "compulsory" : "elective";
            offeringsAdded++;
          }
        }
        const ref = col(sid, "classLevels").doc(level.id);
        if (level.isNew) {
          tx.set(ref, { name, nameKey: key, section, order: SECTION_BASE[section] + i + 1, subjects: level.subjects, createdAt: now(), updatedAt: now() });
        } else {
          tx.update(ref, { subjects: level.subjects, updatedAt: now() });
        }
      });
    }
    return { levelsAdded, subjectsAdded, offeringsAdded };
  });
}

// WS2 Student Information System: students, admission numbers, enrolments
// (class per session), guardians and parent logins, medical notes, photos,
// withdrawal, bulk import and end-of-session promotion.
import { FieldValue, type DocumentData, type Transaction } from "firebase-admin/firestore";
import { z } from "zod";
import { ADMIN_ROLES, audit, col, db, fail, getOrFail, normalizePhone, now, parse, requireRole, schoolRef, type Ctx } from "../core.js";
import { syncStudentsToSession } from "../sync.js";
import { ensureAccountWithRole } from "./people.js";

const id = z.string().min(1).max(128);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.");
const nameField = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `Enter the ${label}.`)
    .max(60, `The ${label} is too long.`)
    .regex(/^[\p{L}' .-]+$/u, `The ${label} can only contain letters, spaces, hyphens and apostrophes.`);
const optText = (max: number) => z.string().trim().max(max).nullable().optional().transform((s) => (s ? s : null));

export const RELATIONSHIPS = ["Mother", "Father", "Guardian", "Grandparent", "Uncle", "Aunt", "Sibling", "Sponsor", "Other"] as const;
const MAX_GUARDIANS = 6;

const today = () => new Date().toISOString().slice(0, 10);
const searchKey = (s: { firstName: string; middleName?: string | null; lastName: string; admissionNo: string }) =>
  [s.firstName, s.middleName ?? "", s.lastName, s.admissionNo].join(" ").toLowerCase().replace(/\s+/g, " ").trim();

async function admin(ctx: Ctx | null, sid: string) {
  return (await requireRole(ctx, sid, ADMIN_ROLES)).ctx;
}

function checkDob(dob: string | null | undefined, admissionDate: string) {
  if (!dob) return;
  if (dob > admissionDate) fail(400, "Date of birth cannot be after the admission date.");
  const age = (Date.parse(admissionDate) - Date.parse(dob)) / (365.25 * 86_400_000);
  if (age < 0.5 || age > 30) fail(400, "Check the date of birth: the student's age looks wrong.");
}

/** Current session id, or a clear error. */
async function currentSession(tx: Transaction, sid: string) {
  const school = (await tx.get(schoolRef(sid))).data();
  if (!school?.currentSessionId) fail(400, "Set the current term first (Sessions & terms).");
  return { sessionId: school!.currentSessionId as string, shortCode: school!.shortCode as string };
}

async function armAndLevel(tx: Transaction, sid: string, armId: string) {
  const arm = await getOrFail<{ levelId: string; name: string; capacity?: number | null }>(col(sid, "classArms").doc(armId), "Class", tx);
  const level = await getOrFail<{ name: string }>(col(sid, "classLevels").doc(arm.levelId), "Class", tx);
  return { arm, level, label: `${level.name} ${arm.name}` };
}

async function assertRoom(tx: Transaction, sid: string, sessionId: string, arm: { id: string; capacity?: number | null }, label: string, adding = 1) {
  if (!arm.capacity) return;
  const enrolled = await tx.get(col(sid, "enrolments").where("sessionId", "==", sessionId).where("armId", "==", arm.id).where("status", "==", "active"));
  if (enrolled.size + adding > arm.capacity) fail(409, `${label} is full (${arm.capacity} students). Increase its capacity under Classes & arms, or choose another arm.`);
}

/** Reserve `count` admission numbers like WPZ/2026/0007 for the admission year. */
async function reserveAdmissionNumbers(tx: Transaction, sid: string, shortCode: string, year: string, count: number) {
  const ref = col(sid, "counters").doc("admission");
  const last = ((await tx.get(ref)).data()?.byYear?.[year] as number | undefined) ?? 0;
  return {
    numbers: Array.from({ length: count }, (_, i) => `${shortCode}/${year}/${String(last + i + 1).padStart(4, "0")}`),
    commit: () => tx.set(ref, { byYear: { [year]: last + count } }, { merge: true }),
  };
}

async function assertAdmissionNoFree(tx: Transaction, sid: string, admissionNo: string, selfId?: string) {
  const same = await tx.get(col(sid, "students").where("admissionNo", "==", admissionNo));
  if (same.docs.some((d) => d.id !== selfId)) fail(409, `Admission number ${admissionNo} is already used by another student.`);
}

// ------------------------------------------------------------------ create / update
const profileSchema = z.object({
  firstName: nameField("first name"),
  middleName: z.string().trim().max(60).nullable().optional().transform((s) => (s ? s : null)),
  lastName: nameField("surname"),
  gender: z.enum(["male", "female"], { message: "Choose male or female." }),
  dateOfBirth: date.nullable().optional(),
  stateOfOrigin: optText(60),
  lga: optText(80),
  religion: optText(40),
});

export async function studentsCreate(input: unknown, ctx: Ctx | null) {
  const v = parse(profileSchema.extend({ schoolId: id, armId: id, admissionDate: date.optional(), admissionNo: z.string().trim().max(30).optional() }), input);
  const c = await admin(ctx, v.schoolId);
  const admissionDate = v.admissionDate ?? today();
  checkDob(v.dateOfBirth, admissionDate);
  return db().runTransaction(async (tx) => {
    const { sessionId, shortCode } = await currentSession(tx, v.schoolId);
    const { arm, level, label } = await armAndLevel(tx, v.schoolId, v.armId);
    await assertRoom(tx, v.schoolId, sessionId, arm, label);
    let admissionNo = v.admissionNo?.toUpperCase();
    let commitCounter: (() => void) | null = null;
    if (admissionNo) await assertAdmissionNoFree(tx, v.schoolId, admissionNo);
    else {
      const r = await reserveAdmissionNumbers(tx, v.schoolId, shortCode, admissionDate.slice(0, 4), 1);
      admissionNo = r.numbers[0];
      commitCounter = r.commit;
    }
    const ref = col(v.schoolId, "students").doc();
    const data = {
      admissionNo,
      firstName: v.firstName,
      middleName: v.middleName,
      lastName: v.lastName,
      gender: v.gender,
      dateOfBirth: v.dateOfBirth ?? null,
      stateOfOrigin: v.stateOfOrigin,
      lga: v.lga,
      religion: v.religion,
      admissionDate,
      status: "active",
      currentSessionId: sessionId,
      currentArmId: arm.id,
      currentLevelId: level.id,
      guardians: [],
      guardianIds: [],
      parentUids: [],
      hasMedicalAlert: false,
      hasPhoto: false,
      photoVersion: 0,
      withdrawal: null,
    };
    commitCounter?.();
    tx.set(ref, { ...data, searchKey: searchKey(data), createdAt: now(), updatedAt: now() });
    tx.set(col(v.schoolId, "enrolments").doc(`${sessionId}__${ref.id}`), {
      studentId: ref.id,
      sessionId,
      armId: arm.id,
      levelId: level.id,
      status: "active",
      startDate: admissionDate,
      endDate: null,
      createdAt: now(),
    });
    audit(tx, v.schoolId, c, { action: "create", entity: "student", entityId: ref.id, after: { ...data, class: label } });
    return { id: ref.id, admissionNo };
  });
}

export async function studentsUpdate(input: unknown, ctx: Ctx | null) {
  const v = parse(profileSchema.extend({ schoolId: id, id, admissionNo: z.string().trim().min(1).max(30), admissionDate: date }), input);
  const c = await admin(ctx, v.schoolId);
  checkDob(v.dateOfBirth, v.admissionDate);
  return db().runTransaction(async (tx) => {
    const ref = col(v.schoolId, "students").doc(v.id);
    const before = await getOrFail<DocumentData>(ref, "Student", tx);
    const admissionNo = v.admissionNo.toUpperCase();
    if (admissionNo !== before.admissionNo) await assertAdmissionNoFree(tx, v.schoolId, admissionNo, v.id);
    const data = {
      admissionNo,
      admissionDate: v.admissionDate,
      firstName: v.firstName,
      middleName: v.middleName,
      lastName: v.lastName,
      gender: v.gender,
      dateOfBirth: v.dateOfBirth ?? null,
      stateOfOrigin: v.stateOfOrigin,
      lga: v.lga,
      religion: v.religion,
    };
    tx.update(ref, { ...data, searchKey: searchKey(data), updatedAt: now() });
    audit(tx, v.schoolId, c, { action: "update", entity: "student", entityId: v.id, before, after: { ...before, ...data } });
    return { ok: true };
  });
}

export async function studentsSetPhoto(input: unknown, ctx: Ctx | null) {
  const v = parse(
    z.object({
      schoolId: id,
      studentId: id,
      dataUrl: z.string().max(300_000, "That photo is too large.").regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, "Photo must be a PNG, JPG or WebP image."),
    }),
    input,
  );
  const c = await admin(ctx, v.schoolId);
  const ref = col(v.schoolId, "students").doc(v.studentId);
  await getOrFail(ref, "Student");
  const version = Date.now();
  const batch = db().batch();
  batch.set(col(v.schoolId, "studentPhotos").doc(v.studentId), { dataUrl: v.dataUrl, updatedAt: now() });
  batch.update(ref, { hasPhoto: true, photoVersion: version, updatedAt: now() });
  audit(batch, v.schoolId, c, { action: "update", entity: "studentPhoto", entityId: v.studentId, after: { photoVersion: version } });
  await batch.commit();
  return { ok: true };
}

export async function studentsSetMedical(input: unknown, ctx: Ctx | null) {
  const v = parse(
    z.object({
      schoolId: id,
      studentId: id,
      bloodGroup: z.enum(["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]).optional(),
      genotype: z.enum(["", "AA", "AS", "AC", "SS", "SC", "CC"]).optional(),
      allergies: optText(500),
      conditions: optText(500),
      medications: optText(500),
      doctor: optText(200),
      notes: optText(1000),
    }),
    input,
  );
  const c = await admin(ctx, v.schoolId);
  return db().runTransaction(async (tx) => {
    const sref = col(v.schoolId, "students").doc(v.studentId);
    await getOrFail(sref, "Student", tx);
    const mref = col(v.schoolId, "studentMedical").doc(v.studentId);
    const before = (await tx.get(mref)).data() ?? null;
    const data = {
      bloodGroup: v.bloodGroup || null,
      genotype: v.genotype || null,
      allergies: v.allergies,
      conditions: v.conditions,
      medications: v.medications,
      doctor: v.doctor,
      notes: v.notes,
    };
    tx.set(mref, { ...data, updatedAt: now() });
    // Teachers see only this flag ("check with the school office"), never the details.
    tx.update(sref, { hasMedicalAlert: Boolean(data.allergies || data.conditions || data.medications), updatedAt: now() });
    audit(tx, v.schoolId, c, { action: before ? "update" : "create", entity: "studentMedical", entityId: v.studentId, before, after: data });
    return { ok: true };
  });
}

// ------------------------------------------------------------------ class changes
export async function studentsChangeArm(input: unknown, ctx: Ctx | null) {
  const v = parse(z.object({ schoolId: id, studentId: id, armId: id }), input);
  const c = await admin(ctx, v.schoolId);
  return db().runTransaction(async (tx) => {
    const { sessionId } = await currentSession(tx, v.schoolId);
    const sref = col(v.schoolId, "students").doc(v.studentId);
    const student = await getOrFail<DocumentData>(sref, "Student", tx);
    if (student.status !== "active") fail(400, "Only active students can change class. Reinstate the student first.");
    const { arm, level, label } = await armAndLevel(tx, v.schoolId, v.armId);
    if (student.currentArmId === arm.id) return { ok: true };
    await assertRoom(tx, v.schoolId, sessionId, arm, label);
    const eref = col(v.schoolId, "enrolments").doc(`${sessionId}__${v.studentId}`);
    const enrol = (await tx.get(eref)).data();
    tx.set(eref, { studentId: v.studentId, sessionId, armId: arm.id, levelId: level.id, status: "active", startDate: enrol?.startDate ?? today(), endDate: null, updatedAt: now() }, { merge: true });
    tx.update(sref, { currentSessionId: sessionId, currentArmId: arm.id, currentLevelId: level.id, updatedAt: now() });
    audit(tx, v.schoolId, c, { action: "update", entity: "studentClass", entityId: v.studentId, before: { armId: student.currentArmId }, after: { armId: arm.id, class: label } });
    return { ok: true };
  });
}

export async function studentsWithdraw(input: unknown, ctx: Ctx | null) {
  const v = parse(z.object({ schoolId: id, studentId: id, date, reason: z.string().trim().min(2, "Give a reason for the withdrawal.").max(500) }), input);
  const c = await admin(ctx, v.schoolId);
  return db().runTransaction(async (tx) => {
    const sref = col(v.schoolId, "students").doc(v.studentId);
    const student = await getOrFail<DocumentData>(sref, "Student", tx);
    if (student.status !== "active") fail(400, "This student is not active.");
    if (v.date < student.admissionDate) fail(400, "The withdrawal date cannot be before the admission date.");
    if (student.currentSessionId) {
      const eref = col(v.schoolId, "enrolments").doc(`${student.currentSessionId}__${v.studentId}`);
      if ((await tx.get(eref)).exists) tx.update(eref, { status: "withdrawn", endDate: v.date, updatedAt: now() });
    }
    // Clearing the class removes the student from registers and teacher views.
    tx.update(sref, { status: "withdrawn", currentArmId: null, currentLevelId: null, withdrawal: { date: v.date, reason: v.reason }, updatedAt: now() });
    audit(tx, v.schoolId, c, { action: "update", entity: "studentStatus", entityId: v.studentId, before: { status: student.status }, after: { status: "withdrawn", date: v.date, reason: v.reason } });
    return { ok: true };
  });
}

export async function studentsReinstate(input: unknown, ctx: Ctx | null) {
  const v = parse(z.object({ schoolId: id, studentId: id, armId: id }), input);
  const c = await admin(ctx, v.schoolId);
  return db().runTransaction(async (tx) => {
    const { sessionId } = await currentSession(tx, v.schoolId);
    const sref = col(v.schoolId, "students").doc(v.studentId);
    const student = await getOrFail<DocumentData>(sref, "Student", tx);
    if (student.status === "active") fail(400, "This student is already active.");
    const { arm, level, label } = await armAndLevel(tx, v.schoolId, v.armId);
    await assertRoom(tx, v.schoolId, sessionId, arm, label);
    tx.set(col(v.schoolId, "enrolments").doc(`${sessionId}__${v.studentId}`), {
      studentId: v.studentId, sessionId, armId: arm.id, levelId: level.id, status: "active", startDate: today(), endDate: null, updatedAt: now(),
    }, { merge: true });
    tx.update(sref, { status: "active", currentSessionId: sessionId, currentArmId: arm.id, currentLevelId: level.id, withdrawal: null, updatedAt: now() });
    audit(tx, v.schoolId, c, { action: "update", entity: "studentStatus", entityId: v.studentId, before: { status: student.status }, after: { status: "active", class: label } });
    return { ok: true };
  });
}

// ------------------------------------------------------------------ guardians
const guardianFields = z.object({
  fullName: z.string().trim().min(2, "Enter the guardian's full name.").max(120),
  phone: z.string().trim().max(30).nullable().optional(),
  whatsappPhone: z.string().trim().max(30).nullable().optional(),
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").nullable().optional().or(z.literal("")),
  address: optText(300),
  occupation: optText(100),
});

function cleanGuardian(g: z.infer<typeof guardianFields>) {
  const phone = g.phone ? normalizePhone(g.phone) : null;
  if (g.phone && !phone) fail(400, "Enter a valid phone number for the guardian, e.g. 0803 123 4567.");
  const whatsappPhone = g.whatsappPhone ? normalizePhone(g.whatsappPhone) : null;
  if (g.whatsappPhone && !whatsappPhone) fail(400, "Enter a valid WhatsApp number.");
  if (!phone && !g.email) fail(400, "Give the guardian a phone number or an email address, so the school can reach them.");
  return { fullName: g.fullName, phone, whatsappPhone: whatsappPhone ?? phone, email: g.email || null, address: g.address, occupation: g.occupation };
}

const linkSchema = z.object({
  relationship: z.enum(RELATIONSHIPS),
  isPrimary: z.boolean().default(false),
  canPickup: z.boolean().default(true),
  receivesBilling: z.boolean().default(true),
});

type Link = z.infer<typeof linkSchema> & { guardianId: string };

/** Add a guardian to a student: link an existing one (by id, or found by phone) or create a new one. Optionally give them a parent login. */
export async function guardiansAdd(input: unknown, ctx: Ctx | null) {
  const v = parse(
    linkSchema.extend({
      schoolId: id,
      studentId: id,
      guardianId: id.optional(),
      guardian: guardianFields.optional(),
      createLogin: z.boolean().default(false),
    }),
    input,
  );
  const c = await admin(ctx, v.schoolId);
  if (!v.guardianId && !v.guardian) fail(400, "Choose an existing guardian or enter the new guardian's details.");
  const fresh = v.guardian ? cleanGuardian(v.guardian) : null;

  // Resolve which guardian record to use (dedupe by phone within the school).
  let guardianId = v.guardianId ?? null;
  if (!guardianId && fresh?.phone) {
    const match = await col(v.schoolId, "guardians").where("phone", "==", fresh.phone).limit(1).get();
    guardianId = match.docs[0]?.id ?? null;
  }

  // Parent login first (it creates an auth account and membership in its own transaction).
  let uid: string | null = null;
  let loginEmail: string | null = null;
  if (v.createLogin) {
    const source = fresh ?? (guardianId ? ((await col(v.schoolId, "guardians").doc(guardianId).get()).data() as ReturnType<typeof cleanGuardian> | undefined) : undefined);
    if (!source) fail(404, "Guardian not found.");
    if (!source!.phone && !source!.email) fail(400, "A parent login needs a phone number or email.");
    const account = await ensureAccountWithRole(v.schoolId, { fullName: source!.fullName, email: source!.phone ? null : source!.email, phone: source!.phone }, "parent", c);
    uid = account.uid;
    if (account.created && !source!.phone) loginEmail = source!.email;
  }

  return db().runTransaction(async (tx) => {
    const sref = col(v.schoolId, "students").doc(v.studentId);
    const student = await getOrFail<DocumentData>(sref, "Student", tx);
    const gref = guardianId ? col(v.schoolId, "guardians").doc(guardianId) : col(v.schoolId, "guardians").doc();
    const existing = guardianId ? await getOrFail<DocumentData>(gref, "Guardian", tx) : null;
    const links = (student.guardians ?? []) as Link[];
    if (links.some((l) => l.guardianId === gref.id)) fail(409, "This guardian is already linked to the student.");
    if (links.length >= MAX_GUARDIANS) fail(400, `A student can have at most ${MAX_GUARDIANS} guardians.`);

    const finalUid = uid ?? (existing?.uid as string | null | undefined) ?? null;
    if (existing) {
      tx.update(gref, { studentIds: FieldValue.arrayUnion(v.studentId), ...(uid ? { uid } : {}), updatedAt: now() });
    } else {
      tx.set(gref, { ...fresh!, uid: finalUid, studentIds: [v.studentId], createdAt: now(), updatedAt: now() });
    }
    const link: Link = { guardianId: gref.id, relationship: v.relationship, isPrimary: v.isPrimary || links.length === 0, canPickup: v.canPickup, receivesBilling: v.receivesBilling };
    const nextLinks = [...links.map((l) => (link.isPrimary ? { ...l, isPrimary: false } : l)), link];
    tx.update(sref, {
      guardians: nextLinks,
      guardianIds: nextLinks.map((l) => l.guardianId),
      ...(finalUid ? { parentUids: FieldValue.arrayUnion(finalUid) } : {}),
      updatedAt: now(),
    });
    audit(tx, v.schoolId, c, { action: "create", entity: "studentGuardian", entityId: `${v.studentId}:${gref.id}`, after: { ...link, guardian: existing?.fullName ?? fresh?.fullName, login: Boolean(finalUid) } });
    return { guardianId: gref.id, reused: Boolean(existing), uid: finalUid, sendPasswordEmailTo: loginEmail };
  });
}

export async function guardiansUpdate(input: unknown, ctx: Ctx | null) {
  const v = parse(guardianFields.extend({ schoolId: id, guardianId: id }), input);
  const c = await admin(ctx, v.schoolId);
  const data = cleanGuardian(v);
  return db().runTransaction(async (tx) => {
    const ref = col(v.schoolId, "guardians").doc(v.guardianId);
    const before = await getOrFail<DocumentData>(ref, "Guardian", tx);
    if (data.phone && data.phone !== before.phone) {
      const clash = await tx.get(col(v.schoolId, "guardians").where("phone", "==", data.phone).limit(2));
      if (clash.docs.some((d) => d.id !== v.guardianId)) fail(409, "Another guardian already uses that phone number. Link that guardian instead.");
    }
    tx.update(ref, { ...data, updatedAt: now() });
    audit(tx, v.schoolId, c, { action: "update", entity: "guardian", entityId: v.guardianId, before, after: { ...before, ...data } });
    return { ok: true };
  });
}

/** Change how a guardian relates to a student (primary, pickup, billing, relationship). */
export async function guardiansSetLink(input: unknown, ctx: Ctx | null) {
  const v = parse(linkSchema.extend({ schoolId: id, studentId: id, guardianId: id }), input);
  const c = await admin(ctx, v.schoolId);
  return db().runTransaction(async (tx) => {
    const sref = col(v.schoolId, "students").doc(v.studentId);
    const student = await getOrFail<DocumentData>(sref, "Student", tx);
    const links = (student.guardians ?? []) as Link[];
    const current = links.find((l) => l.guardianId === v.guardianId);
    if (!current) fail(404, "This guardian is not linked to the student.");
    const updated: Link = { guardianId: v.guardianId, relationship: v.relationship, isPrimary: v.isPrimary, canPickup: v.canPickup, receivesBilling: v.receivesBilling };
    let next = links.map((l) => (l.guardianId === v.guardianId ? updated : v.isPrimary ? { ...l, isPrimary: false } : l));
    if (!next.some((l) => l.isPrimary)) next = next.map((l, i) => (i === 0 ? { ...l, isPrimary: true } : l));
    tx.update(sref, { guardians: next, updatedAt: now() });
    audit(tx, v.schoolId, c, { action: "update", entity: "studentGuardian", entityId: `${v.studentId}:${v.guardianId}`, before: current, after: updated });
    return { ok: true };
  });
}

export async function guardiansUnlink(input: unknown, ctx: Ctx | null) {
  const v = parse(z.object({ schoolId: id, studentId: id, guardianId: id }), input);
  const c = await admin(ctx, v.schoolId);
  return db().runTransaction(async (tx) => {
    const sref = col(v.schoolId, "students").doc(v.studentId);
    const gref = col(v.schoolId, "guardians").doc(v.guardianId);
    const student = await getOrFail<DocumentData>(sref, "Student", tx);
    const guardian = await getOrFail<DocumentData>(gref, "Guardian", tx);
    const links = (student.guardians ?? []) as Link[];
    const removed = links.find((l) => l.guardianId === v.guardianId);
    if (!removed) fail(404, "This guardian is not linked to the student.");
    let next = links.filter((l) => l.guardianId !== v.guardianId);
    if (next.length && !next.some((l) => l.isPrimary)) next = next.map((l, i) => (i === 0 ? { ...l, isPrimary: true } : l));
    tx.update(sref, {
      guardians: next,
      guardianIds: next.map((l) => l.guardianId),
      ...(guardian.uid ? { parentUids: FieldValue.arrayRemove(guardian.uid) } : {}),
      updatedAt: now(),
    });
    tx.update(gref, { studentIds: FieldValue.arrayRemove(v.studentId), updatedAt: now() });
    audit(tx, v.schoolId, c, { action: "delete", entity: "studentGuardian", entityId: `${v.studentId}:${v.guardianId}`, before: { ...removed, guardian: guardian.fullName } });
    return { ok: true };
  });
}

/** Give an existing guardian a parent login, and let them see all their children. */
export async function guardiansEnableLogin(input: unknown, ctx: Ctx | null) {
  const v = parse(z.object({ schoolId: id, guardianId: id }), input);
  const c = await admin(ctx, v.schoolId);
  const gref = col(v.schoolId, "guardians").doc(v.guardianId);
  const g = await getOrFail<DocumentData>(gref, "Guardian");
  if (g.uid) return { uid: g.uid, already: true };
  if (!g.phone && !g.email) fail(400, "Add a phone number or email for this guardian first.");
  const { uid, created } = await ensureAccountWithRole(v.schoolId, { fullName: g.fullName, email: g.phone ? null : g.email, phone: g.phone }, "parent", c);
  const batch = db().batch();
  batch.update(gref, { uid, updatedAt: now() });
  for (const studentId of (g.studentIds ?? []) as string[]) batch.update(col(v.schoolId, "students").doc(studentId), { parentUids: FieldValue.arrayUnion(uid) });
  audit(batch, v.schoolId, c, { action: "update", entity: "guardian", entityId: v.guardianId, after: { parentLogin: true } });
  await batch.commit();
  return { uid, already: false, sendPasswordEmailTo: created && !g.phone ? (g.email as string) : null };
}

// ------------------------------------------------------------------ bulk import
const IMPORT_MAX = 300;

const rowSchema = z.object({
  firstName: z.string().optional(),
  middleName: z.string().optional(),
  lastName: z.string().optional(),
  gender: z.string().optional(),
  dateOfBirth: z.string().optional(),
  className: z.string().optional(),
  arm: z.string().optional(),
  admissionNo: z.string().optional(),
  admissionDate: z.string().optional(),
  guardianName: z.string().optional(),
  guardianPhone: z.string().optional(),
  guardianEmail: z.string().optional(),
  relationship: z.string().optional(),
});
export type ImportRow = z.infer<typeof rowSchema>;

/** Accept 2014-05-30, 30/05/2014 or 30-05-2014. */
export function parseDate(s: string | undefined): string | null | "invalid" {
  const t = (s ?? "").trim();
  if (!t) return null;
  let y: number, m: number, d: number;
  let match = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else return "invalid";
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return "invalid";
  return dt.toISOString().slice(0, 10);
}

const cap = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (x) => x.toUpperCase());

/**
 * Import students (with one guardian each) from a spreadsheet.
 * dryRun: true checks every row and reports problems without saving anything.
 * A real run saves only if every row is valid.
 */
export async function studentsImport(input: unknown, ctx: Ctx | null) {
  const v = parse(z.object({ schoolId: id, dryRun: z.boolean(), rows: z.array(rowSchema).min(1, "The file has no student rows.").max(IMPORT_MAX, `Import at most ${IMPORT_MAX} students at a time.`) }), input);
  const c = await admin(ctx, v.schoolId);
  const sid = v.schoolId;

  const [school, levels, arms, existingStudents, existingGuardians] = await Promise.all([
    schoolRef(sid).get(),
    col(sid, "classLevels").get(),
    col(sid, "classArms").get(),
    col(sid, "students").select("admissionNo").get(),
    col(sid, "guardians").select("phone").get(),
  ]);
  const sessionId = school.data()?.currentSessionId as string | undefined;
  if (!sessionId) fail(400, "Set the current term first (Sessions & terms).");
  const shortCode = school.data()!.shortCode as string;
  const levelByName = new Map(levels.docs.map((l) => [String(l.data().nameKey), l]));
  const armsByLevel = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>();
  for (const a of arms.docs) armsByLevel.set(a.data().levelId, [...(armsByLevel.get(a.data().levelId) ?? []), a]);
  const usedAdmission = new Set(existingStudents.docs.map((d) => String(d.data().admissionNo).toUpperCase()));
  const guardianByPhone = new Map(existingGuardians.docs.filter((d) => d.data().phone).map((d) => [d.data().phone as string, d.id]));

  type Clean = { row: number; student: Record<string, unknown>; armId: string; levelId: string; guardian: { fullName: string; phone: string | null; email: string | null; relationship: string } | null; admissionNo: string | null; admissionDate: string };
  const clean: Clean[] = [];
  const errors: { row: number; messages: string[] }[] = [];
  const fileAdmission = new Set<string>();
  const armCount = new Map<string, number>();

  v.rows.forEach((r, i) => {
    const row = i + 2; // spreadsheet row number (row 1 is the header)
    const msgs: string[] = [];
    const firstName = cap(r.firstName ?? "");
    const lastName = cap(r.lastName ?? "");
    const middleName = r.middleName?.trim() ? cap(r.middleName) : null;
    if (!firstName) msgs.push("First name is missing.");
    if (!lastName) msgs.push("Surname is missing.");
    for (const [label, val] of [["First name", firstName], ["Surname", lastName], ["Middle name", middleName ?? ""]] as const) {
      if (val && !/^[\p{L}' .-]+$/u.test(val)) msgs.push(`${label} has characters that are not letters.`);
    }
    const g = (r.gender ?? "").trim().toLowerCase();
    const gender = ["m", "male", "boy"].includes(g) ? "male" : ["f", "female", "girl"].includes(g) ? "female" : null;
    if (!gender) msgs.push("Gender must be Male or Female.");
    const dob = parseDate(r.dateOfBirth);
    if (dob === "invalid") msgs.push(`Date of birth "${r.dateOfBirth}" is not a valid date (use DD/MM/YYYY).`);
    const admissionDate = parseDate(r.admissionDate);
    if (admissionDate === "invalid") msgs.push(`Admission date "${r.admissionDate}" is not a valid date.`);
    const level = levelByName.get((r.className ?? "").trim().replace(/\s+/g, " ").toLowerCase());
    let arm: FirebaseFirestore.QueryDocumentSnapshot | undefined;
    if (!r.className?.trim()) msgs.push("Class is missing.");
    else if (!level) msgs.push(`Class "${r.className}" does not exist. Use the exact class names from Classes & arms.`);
    else {
      const levelArms = armsByLevel.get(level.id) ?? [];
      const wanted = (r.arm ?? "").trim().toLowerCase();
      arm = wanted ? levelArms.find((a) => a.data().nameKey === wanted) : levelArms.length === 1 ? levelArms[0] : undefined;
      if (!levelArms.length) msgs.push(`${level.data().name} has no arms yet. Add one under Classes & arms.`);
      else if (!arm) msgs.push(wanted ? `${level.data().name} has no arm "${r.arm}".` : `${level.data().name} has several arms: say which one in the Arm column.`);
    }
    const admissionNo = r.admissionNo?.trim().toUpperCase() || null;
    if (admissionNo) {
      if (usedAdmission.has(admissionNo)) msgs.push(`Admission number ${admissionNo} is already used.`);
      if (fileAdmission.has(admissionNo)) msgs.push(`Admission number ${admissionNo} appears twice in the file.`);
      fileAdmission.add(admissionNo);
    }
    let guardian: Clean["guardian"] = null;
    const gName = r.guardianName?.trim();
    const gPhoneRaw = r.guardianPhone?.trim();
    const gEmail = r.guardianEmail?.trim().toLowerCase() || null;
    if (gName || gPhoneRaw || gEmail) {
      const gPhone = gPhoneRaw ? normalizePhone(gPhoneRaw) : null;
      if (!gName) msgs.push("Guardian name is missing (a guardian phone or email was given).");
      if (gPhoneRaw && !gPhone) msgs.push(`Guardian phone "${gPhoneRaw}" is not a valid number.`);
      if (!gPhoneRaw && !gEmail) msgs.push("Give the guardian a phone number or email.");
      if (gEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(gEmail)) msgs.push(`Guardian email "${gEmail}" is not valid.`);
      const rel = RELATIONSHIPS.find((x) => x.toLowerCase() === (r.relationship ?? "").trim().toLowerCase()) ?? (r.relationship?.trim() ? null : "Guardian");
      if (!rel) msgs.push(`Relationship "${r.relationship}" should be one of: ${RELATIONSHIPS.join(", ")}.`);
      guardian = { fullName: cap(gName ?? ""), phone: gPhone, email: gEmail, relationship: rel ?? "Guardian" };
    }
    if (msgs.length) return errors.push({ row, messages: msgs });
    armCount.set(arm!.id, (armCount.get(arm!.id) ?? 0) + 1);
    clean.push({
      row,
      armId: arm!.id,
      levelId: level!.id,
      admissionNo,
      admissionDate: (admissionDate as string | null) ?? today(),
      guardian,
      student: { firstName, middleName, lastName, gender, dateOfBirth: dob as string | null },
    });
  });

  // Capacity per arm (current + imported).
  for (const [armId, adding] of armCount) {
    const arm = arms.docs.find((a) => a.id === armId)!;
    const capacity = arm.data().capacity as number | null;
    if (!capacity) continue;
    const enrolled = (await col(sid, "enrolments").where("sessionId", "==", sessionId).where("armId", "==", armId).where("status", "==", "active").count().get()).data().count;
    if (enrolled + adding > capacity) {
      const level = levels.docs.find((l) => l.id === arm.data().levelId)!.data().name;
      errors.push({ row: 0, messages: [`${level} ${arm.data().name} would have ${enrolled + adding} students, but its capacity is ${capacity}. Raise the capacity or split the class.`] });
    }
  }

  errors.sort((a, b) => a.row - b.row);
  if (v.dryRun || errors.length) return { ok: errors.length === 0, valid: clean.length, total: v.rows.length, errors, saved: 0 };

  // Save. Admission numbers are reserved in one transaction, then rows are written in batches.
  const byYear = new Map<string, Clean[]>();
  for (const r of clean.filter((x) => !x.admissionNo)) byYear.set(r.admissionDate.slice(0, 4), [...(byYear.get(r.admissionDate.slice(0, 4)) ?? []), r]);
  await db().runTransaction(async (tx) => {
    const reserved = await Promise.all([...byYear].map(async ([year, rows]) => ({ rows, r: await reserveAdmissionNumbers(tx, sid, shortCode, year, rows.length) })));
    for (const { rows, r } of reserved) {
      rows.forEach((row, i) => (row.admissionNo = r.numbers[i]));
      r.commit();
    }
  });

  let guardiansCreated = 0;
  let guardiansLinked = 0;
  const guardianStudents = new Map<string, string[]>();
  for (let i = 0; i < clean.length; i += 150) {
    const batch = db().batch();
    for (const r of clean.slice(i, i + 150)) {
      const sref = col(sid, "students").doc();
      let links: Link[] = [];
      if (r.guardian) {
        let gid = r.guardian.phone ? guardianByPhone.get(r.guardian.phone) : undefined;
        if (!gid) {
          const gref = col(sid, "guardians").doc();
          gid = gref.id;
          batch.set(gref, { fullName: r.guardian.fullName, phone: r.guardian.phone, whatsappPhone: r.guardian.phone, email: r.guardian.email, address: null, occupation: null, uid: null, studentIds: [], createdAt: now(), updatedAt: now() });
          if (r.guardian.phone) guardianByPhone.set(r.guardian.phone, gid);
          guardiansCreated++;
        } else guardiansLinked++;
        guardianStudents.set(gid, [...(guardianStudents.get(gid) ?? []), sref.id]);
        links = [{ guardianId: gid, relationship: r.guardian.relationship as Link["relationship"], isPrimary: true, canPickup: true, receivesBilling: true }];
      }
      const data = {
        ...r.student,
        admissionNo: r.admissionNo!,
        admissionDate: r.admissionDate,
        stateOfOrigin: null,
        lga: null,
        religion: null,
        status: "active",
        currentSessionId: sessionId,
        currentArmId: r.armId,
        currentLevelId: r.levelId,
        guardians: links,
        guardianIds: links.map((l) => l.guardianId),
        parentUids: [],
        hasMedicalAlert: false,
        hasPhoto: false,
        photoVersion: 0,
        withdrawal: null,
      };
      batch.set(sref, { ...data, searchKey: searchKey(data as never), createdAt: now(), updatedAt: now() });
      batch.set(col(sid, "enrolments").doc(`${sessionId}__${sref.id}`), {
        studentId: sref.id, sessionId, armId: r.armId, levelId: r.levelId, status: "active", startDate: r.admissionDate, endDate: null, createdAt: now(),
      });
    }
    await batch.commit();
  }
  // Point guardians at their students (one update per guardian).
  const entries = [...guardianStudents];
  for (let i = 0; i < entries.length; i += 400) {
    const batch = db().batch();
    for (const [gid, sids] of entries.slice(i, i + 400)) batch.update(col(sid, "guardians").doc(gid), { studentIds: FieldValue.arrayUnion(...sids), updatedAt: now() });
    await batch.commit();
  }
  const done = db().batch();
  audit(done, sid, c, { action: "create", entity: "studentImport", entityId: `import-${Date.now()}`, after: { students: clean.length, guardiansCreated, guardiansLinked } });
  await done.commit();
  return { ok: true, valid: clean.length, total: v.rows.length, errors: [], saved: clean.length, guardiansCreated, guardiansLinked };
}

// ------------------------------------------------------------------ promotion
type Plan = { studentId: string; name: string; fromLevel: string; action: "promote" | "repeat" | "graduate"; toLevelId: string | null; toArmId: string | null; toLabel: string };

/**
 * Move every active student from one session's classes into the next session.
 * Default: next class in order (last class graduates), same arm name if it
 * exists. Per-class targets and per-student exceptions override that.
 * dryRun returns the plan without saving. Safe to run twice: students already
 * placed in the target session are skipped.
 */
export async function promotionRun(input: unknown, ctx: Ctx | null) {
  const v = parse(
    z.object({
      schoolId: id,
      fromSessionId: id,
      toSessionId: id,
      dryRun: z.boolean(),
      levelTargets: z.record(z.string(), z.string()).default({}),
      exceptions: z.record(z.string(), z.enum(["repeat", "graduate"])).default({}),
    }),
    input,
  );
  const c = await admin(ctx, v.schoolId);
  const sid = v.schoolId;
  if (v.fromSessionId === v.toSessionId) fail(400, "Choose two different sessions.");
  const [from, to, levels, arms, enrolments, school] = await Promise.all([
    getOrFail<{ name: string; startDate: string; endDate: string }>(col(sid, "sessions").doc(v.fromSessionId), "Session"),
    getOrFail<{ name: string; startDate: string }>(col(sid, "sessions").doc(v.toSessionId), "Session"),
    col(sid, "classLevels").get(),
    col(sid, "classArms").get(),
    col(sid, "enrolments").where("sessionId", "in", [v.fromSessionId, v.toSessionId]).get(),
    schoolRef(sid).get(),
  ]);
  if (to.startDate <= from.startDate) fail(400, `${to.name} must start after ${from.name}.`);

  const ordered = levels.docs.map((l) => ({ id: l.id, name: l.data().name as string, order: l.data().order as number })).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  const levelName = new Map(ordered.map((l) => [l.id, l.name]));
  const armsOf = (levelId: string) => arms.docs.filter((a) => a.data().levelId === levelId).sort((a, b) => a.data().name.localeCompare(b.data().name, undefined, { numeric: true }));
  const defaultTarget = (levelId: string) => {
    const i = ordered.findIndex((l) => l.id === levelId);
    return ordered[i + 1]?.id ?? "graduate";
  };

  const source = enrolments.docs.filter((e) => e.data().sessionId === v.fromSessionId && e.data().status === "active");
  const alreadyPlaced = new Set(enrolments.docs.filter((e) => e.data().sessionId === v.toSessionId).map((e) => e.data().studentId as string));
  const studentSnaps = source.length ? await db().getAll(...source.map((e) => col(sid, "students").doc(e.data().studentId))) : [];
  const studentById = new Map(studentSnaps.map((s) => [s.id, s.data()]));

  const plans: Plan[] = [];
  const problems = new Set<string>();
  let skipped = 0;
  for (const e of source) {
    const d = e.data();
    const st = studentById.get(d.studentId);
    if (!st || st.status !== "active") continue;
    if (alreadyPlaced.has(d.studentId) || d.outcome) {
      skipped++;
      continue;
    }
    const exception = v.exceptions[d.studentId];
    const target = exception === "repeat" ? d.levelId : exception === "graduate" ? "graduate" : v.levelTargets[d.levelId] ?? defaultTarget(d.levelId);
    const name = `${st.firstName} ${st.lastName}`;
    const fromLevel = levelName.get(d.levelId) ?? "?";
    if (target === "graduate") {
      plans.push({ studentId: d.studentId, name, fromLevel, action: "graduate", toLevelId: null, toArmId: null, toLabel: "Graduates" });
      continue;
    }
    if (!levelName.has(target)) {
      problems.add(`The target class for ${fromLevel} no longer exists.`);
      continue;
    }
    const currentArmName = arms.docs.find((a) => a.id === d.armId)?.data().nameKey;
    const targetArms = armsOf(target);
    const arm = targetArms.find((a) => a.data().nameKey === currentArmName) ?? targetArms[0];
    if (!arm) {
      problems.add(`${levelName.get(target)} has no arms. Add one under Classes & arms before promoting.`);
      continue;
    }
    plans.push({ studentId: d.studentId, name, fromLevel, action: target === d.levelId ? "repeat" : "promote", toLevelId: target, toArmId: arm.id, toLabel: `${levelName.get(target)} ${arm.data().name}` });
  }

  const summary = new Map<string, { from: string; to: string; count: number }>();
  for (const p of plans) {
    const key = `${p.fromLevel}->${p.toLabel}`;
    summary.set(key, { from: p.fromLevel, to: p.toLabel, count: (summary.get(key)?.count ?? 0) + 1 });
  }
  const result = {
    from: from.name,
    to: to.name,
    promote: plans.filter((p) => p.action === "promote").length,
    repeat: plans.filter((p) => p.action === "repeat").length,
    graduate: plans.filter((p) => p.action === "graduate").length,
    skipped,
    problems: [...problems],
    moves: [...summary.values()].sort((a, b) => a.from.localeCompare(b.from, undefined, { numeric: true })),
    students: plans.map(({ studentId, name, fromLevel, toLabel, action }) => ({ studentId, name, fromLevel, toLabel, action })),
  };
  if (v.dryRun || problems.size) return { ...result, saved: false };

  // Only the outcome is recorded now. Students stay in this session's classes
  // (registers, results) until the school makes a term of the new session
  // current; then syncStudentsToSession applies every outcome at once.
  const startDate = to.startDate;
  for (let i = 0; i < plans.length; i += 150) {
    const batch = db().batch();
    for (const p of plans.slice(i, i + 150)) {
      batch.update(col(sid, "enrolments").doc(`${v.fromSessionId}__${p.studentId}`), {
        outcome: p.action === "graduate" ? "graduated" : p.action === "repeat" ? "repeated" : "promoted",
        endDate: from.endDate,
        updatedAt: now(),
      });
      if (p.action !== "graduate") {
        batch.set(col(sid, "enrolments").doc(`${v.toSessionId}__${p.studentId}`), {
          studentId: p.studentId, sessionId: v.toSessionId, armId: p.toArmId, levelId: p.toLevelId, status: "active", startDate, endDate: null, createdAt: now(),
        });
      }
    }
    await batch.commit();
  }
  // If the target session is already current, move students into their new classes now;
  // otherwise this happens when the school switches to that session.
  if (school.data()?.currentSessionId === v.toSessionId) await syncStudentsToSession(sid, v.toSessionId);
  const done = db().batch();
  audit(done, sid, c, { action: "create", entity: "promotion", entityId: `${v.fromSessionId}->${v.toSessionId}`, after: { promote: result.promote, repeat: result.repeat, graduate: result.graduate } });
  await done.commit();
  return { ...result, saved: true };
}

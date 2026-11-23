// WS0: schools, school settings, logo, memberships (invite / roles / suspend / remove), own profile.
import { randomBytes } from "node:crypto";
import { FieldValue, type Transaction } from "firebase-admin/firestore";
import { z } from "zod";
import {
  ADMIN_ROLES,
  ROLES,
  adminAuth,
  audit,
  canManageRole,
  col,
  db,
  fail,
  getOrFail,
  normalizePhone,
  now,
  parse,
  requirePlatformAdmin,
  requireRole,
  requireUser,
  schoolRef,
  type Ctx,
  type Role,
} from "../core.js";

const id = z.string().min(1).max(128);
const roleSchema = z.enum(ROLES);

export const DEFAULT_SETTINGS = {
  motto: null,
  address: null,
  city: null,
  state: null,
  country: "Nigeria",
  phone: null,
  email: null,
  website: null,
  primaryColor: "#14213D",
  accentColor: "#0F766E",
  currency: "NGN",
  timezone: "Africa/Lagos",
  hasLogo: false,
  logoVersion: 0,
};

// ------------------------------------------------------------------ schools
const schoolCreateInput = z.object({
  name: z.string().trim().min(2, "Enter the school name.").max(200),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/, "Web name: 3-50 lowercase letters, numbers or dashes."),
  shortCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,8}$/, "Short code: 2-8 capital letters or numbers, e.g. WPZ."),
});

export async function createSchoolDoc(v: z.infer<typeof schoolCreateInput>, c: Ctx | null, fixedId?: string) {
  return db().runTransaction(async (tx) => {
    const slugRef = db().collection("slugs").doc(v.slug);
    if ((await tx.get(slugRef)).exists) fail(409, "Another school already uses that web name.");
    const ref = fixedId ? schoolRef(fixedId) : db().collection("schools").doc();
    const data = { name: v.name, slug: v.slug, shortCode: v.shortCode, status: "active", settings: DEFAULT_SETTINGS, currentTermId: null, currentSessionId: null };
    tx.set(ref, { ...data, createdAt: now(), updatedAt: now() });
    tx.set(slugRef, { schoolId: ref.id });
    audit(tx, ref.id, c, { action: "create", entity: "school", entityId: ref.id, after: data });
    return { id: ref.id };
  });
}

export async function schoolsCreate(input: unknown, ctx: Ctx | null) {
  const c = requirePlatformAdmin(ctx);
  return createSchoolDoc(parse(schoolCreateInput, input), c);
}

const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Colours must look like #14213D.");
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().transform((s) => (s ? s : null));

export async function schoolsUpdate(input: unknown, ctx: Ctx | null) {
  const v = parse(
    z.object({
      schoolId: id,
      name: z.string().trim().min(2, "Enter the school name.").max(200),
      settings: z.object({
        motto: optionalText(200),
        address: optionalText(500),
        city: optionalText(100),
        state: optionalText(100),
        phone: z.string().nullable().optional(),
        email: z.string().trim().toLowerCase().email("Enter a valid email address.").nullable().optional().or(z.literal("")),
        website: optionalText(200),
        primaryColor: hex,
        accentColor: hex,
      }),
    }),
    input,
  );
  const { ctx: c } = await requireRole(ctx, v.schoolId, ADMIN_ROLES);
  const phone = v.settings.phone ? normalizePhone(v.settings.phone) : null;
  if (v.settings.phone && !phone) fail(400, "Enter a valid phone number, e.g. 0803 123 4567.");
  return db().runTransaction(async (tx) => {
    const before = await getOrFail<{ name: string; settings: Record<string, unknown> }>(schoolRef(v.schoolId), "School", tx);
    const settings = { ...before.settings, ...v.settings, phone, email: v.settings.email || null };
    tx.update(schoolRef(v.schoolId), { name: v.name, settings, updatedAt: now() });
    audit(tx, v.schoolId, c, { action: "update", entity: "school", entityId: v.schoolId, before: { name: before.name, settings: before.settings }, after: { name: v.name, settings } });
    return { ok: true };
  });
}

/** Logos are stored small (resized in the browser) inside Firestore, so no paid Storage plan is needed. */
export async function schoolsSetLogo(input: unknown, ctx: Ctx | null) {
  const v = parse(
    z.object({
      schoolId: id,
      dataUrl: z
        .string()
        .max(400_000, "That logo is too large. Use a simpler image.")
        .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, "Logo must be a PNG, JPG or WebP image."),
    }),
    input,
  );
  const { ctx: c } = await requireRole(ctx, v.schoolId, ADMIN_ROLES);
  const version = Date.now();
  const batch = db().batch();
  batch.set(col(v.schoolId, "assets").doc("logo"), { dataUrl: v.dataUrl, updatedAt: now() });
  batch.update(schoolRef(v.schoolId), { "settings.hasLogo": true, "settings.logoVersion": version, updatedAt: now() });
  audit(batch, v.schoolId, c, { action: "update", entity: "logo", entityId: v.schoolId, after: { logoVersion: version } });
  await batch.commit();
  return { ok: true, logoVersion: version };
}

// ------------------------------------------------------------------ memberships
type MemberDoc = { uid: string; fullName: string | null; email: string | null; phone: string | null; roles: Role[]; status: "active" | "suspended" };

function syncUserMembership(tx: Transaction, uid: string, sid: string, m: { roles: Role[]; status: string } | null) {
  const ref = db().collection("users").doc(uid);
  if (m) tx.set(ref, { memberships: { [sid]: { roles: m.roles, status: m.status } }, updatedAt: now() }, { merge: true });
  else tx.set(ref, { memberships: { [sid]: FieldValue.delete() }, updatedAt: now() }, { merge: true });
}

async function assertKeepsProprietor(tx: Transaction, sid: string, uid: string) {
  const others = await tx.get(col(sid, "members").where("roles", "array-contains", "proprietor"));
  if (!others.docs.some((d) => d.id !== uid && d.data().status === "active")) fail(409, "A school must keep at least one active proprietor.");
}

async function loadManageable(tx: Transaction, ctx: Ctx, actorRoles: Role[], sid: string, uid: string) {
  if (uid === ctx.uid) fail(400, "You cannot change your own access.");
  const ref = col(sid, "members").doc(uid);
  const member = await getOrFail<MemberDoc>(ref, "Person", tx);
  if (!member.roles.every((r) => canManageRole(actorRoles, ctx.platformAdmin, r))) fail(403, "You are not allowed to change this person's access.");
  return { ref, member };
}

export async function membersInvite(input: unknown, ctx: Ctx | null) {
  const v = parse(
    z.object({
      schoolId: id,
      role: roleSchema,
      fullName: z.string().trim().min(2, "Enter the person's full name.").max(200),
      email: z.string().trim().toLowerCase().email("Enter a valid email address.").optional(),
      phone: z.string().optional(),
    }),
    input,
  );
  const { ctx: c, roles } = await requireRole(ctx, v.schoolId, ADMIN_ROLES);
  if (!canManageRole(roles, c.platformAdmin, v.role)) fail(403, "You are not allowed to give this role in this school.");
  const phone = v.phone ? normalizePhone(v.phone) : null;
  if (v.phone && !phone) fail(400, "Enter a valid phone number, e.g. 0803 123 4567.");
  if (!v.email && !phone) fail(400, "Enter an email address or a phone number.");

  // Find or create the login account.
  let user = await (v.email ? adminAuth().getUserByEmail(v.email) : adminAuth().getUserByPhoneNumber(phone!)).catch(() => null);
  let created = false;
  if (!user) {
    user = await adminAuth().createUser(
      v.email
        ? { email: v.email, displayName: v.fullName, password: randomBytes(24).toString("base64url"), ...(phone ? { phoneNumber: phone } : {}) }
        : { phoneNumber: phone!, displayName: v.fullName },
    );
    created = true;
  }
  if (user.uid === c.uid) fail(400, "You cannot change your own access.");
  const uid = user.uid;

  await db().runTransaction(async (tx) => {
    const ref = col(v.schoolId, "members").doc(uid);
    const userRef = db().collection("users").doc(uid);
    const [existing, profile] = await Promise.all([tx.get(ref), tx.get(userRef)]);
    const before = existing.exists ? (existing.data() as MemberDoc) : null;
    const fullName = (profile.data()?.fullName as string | undefined) || before?.fullName || v.fullName;
    const member: MemberDoc = {
      uid,
      fullName,
      email: user!.email ?? null,
      phone: user!.phoneNumber ?? null,
      roles: [...new Set([...(before?.roles ?? []), v.role])],
      status: "active",
    };
    tx.set(ref, { ...member, invitedBy: c.uid, updatedAt: now(), ...(before ? {} : { createdAt: now() }) }, { merge: true });
    if (!profile.exists) tx.set(userRef, { fullName, email: member.email, phone: member.phone, activeSchoolId: v.schoolId, createdAt: now() }, { merge: true });
    syncUserMembership(tx, uid, v.schoolId, member);
    audit(tx, v.schoolId, c, { action: before ? "update" : "create", entity: "member", entityId: uid, before, after: member });
  });

  return { uid, created, sendPasswordEmail: created && Boolean(v.email) };
}

export async function membersSetRoles(input: unknown, ctx: Ctx | null) {
  const v = parse(z.object({ schoolId: id, uid: id, roles: z.array(roleSchema).min(1, "Keep at least one role, or remove the person instead.") }), input);
  const { ctx: c, roles: actorRoles } = await requireRole(ctx, v.schoolId, ADMIN_ROLES);
  const roles = [...new Set(v.roles)];
  return db().runTransaction(async (tx) => {
    const { ref, member } = await loadManageable(tx, c, actorRoles, v.schoolId, v.uid);
    if (!roles.every((r) => canManageRole(actorRoles, c.platformAdmin, r))) fail(403, "You are not allowed to give this role.");
    if (member.roles.includes("proprietor") && !roles.includes("proprietor") && member.status === "active") await assertKeepsProprietor(tx, v.schoolId, v.uid);
    tx.update(ref, { roles, updatedAt: now() });
    syncUserMembership(tx, v.uid, v.schoolId, { roles, status: member.status });
    audit(tx, v.schoolId, c, { action: "update", entity: "member", entityId: v.uid, before: member, after: { ...member, roles } });
    return { ok: true };
  });
}

export async function membersSetStatus(input: unknown, ctx: Ctx | null) {
  const v = parse(z.object({ schoolId: id, uid: id, status: z.enum(["active", "suspended"]) }), input);
  const { ctx: c, roles: actorRoles } = await requireRole(ctx, v.schoolId, ADMIN_ROLES);
  return db().runTransaction(async (tx) => {
    const { ref, member } = await loadManageable(tx, c, actorRoles, v.schoolId, v.uid);
    if (v.status === "suspended" && member.roles.includes("proprietor")) await assertKeepsProprietor(tx, v.schoolId, v.uid);
    tx.update(ref, { status: v.status, updatedAt: now() });
    syncUserMembership(tx, v.uid, v.schoolId, { roles: member.roles, status: v.status });
    audit(tx, v.schoolId, c, { action: "update", entity: "member", entityId: v.uid, before: member, after: { ...member, status: v.status } });
    return { ok: true };
  });
}

export async function membersRemove(input: unknown, ctx: Ctx | null) {
  const v = parse(z.object({ schoolId: id, uid: id }), input);
  const { ctx: c, roles: actorRoles } = await requireRole(ctx, v.schoolId, ADMIN_ROLES);
  return db().runTransaction(async (tx) => {
    const { ref, member } = await loadManageable(tx, c, actorRoles, v.schoolId, v.uid);
    if (member.roles.includes("proprietor")) await assertKeepsProprietor(tx, v.schoolId, v.uid);
    const tutoring = await tx.get(col(v.schoolId, "classArms").where("formTutorId", "==", v.uid).limit(1));
    const teaching = await tx.get(col(v.schoolId, "assignments").where("teacherId", "==", v.uid).limit(1));
    if (!tutoring.empty || !teaching.empty) fail(409, "This person is a form tutor or has subjects assigned. Reassign those first, or suspend them instead.");
    tx.delete(ref);
    syncUserMembership(tx, v.uid, v.schoolId, null);
    audit(tx, v.schoolId, c, { action: "delete", entity: "member", entityId: v.uid, before: member });
    return { ok: true };
  });
}

// ------------------------------------------------------------------ own profile
export async function meSetActiveSchool(input: unknown, ctx: Ctx | null) {
  const v = parse(z.object({ schoolId: id }), input);
  const c = requireUser(ctx);
  if (!c.platformAdmin) {
    const m = await col(v.schoolId, "members").doc(c.uid).get();
    if (!m.exists || m.data()?.status !== "active") fail(403, "You are not a member of that school.");
  }
  await db().collection("users").doc(c.uid).set({ activeSchoolId: v.schoolId, updatedAt: now() }, { merge: true });
  return { ok: true };
}

export async function meUpdateProfile(input: unknown, ctx: Ctx | null) {
  const v = parse(z.object({ fullName: z.string().trim().min(2, "Enter your full name.").max(200) }), input);
  const c = requireUser(ctx);
  const userRef = db().collection("users").doc(c.uid);
  const memberships = Object.keys(((await userRef.get()).data()?.memberships ?? {}) as Record<string, unknown>);
  const batch = db().batch();
  batch.set(userRef, { fullName: v.fullName, updatedAt: now() }, { merge: true });
  for (const sid of memberships) batch.set(col(sid, "members").doc(c.uid), { fullName: v.fullName, updatedAt: now() }, { merge: true });
  await batch.commit();
  await adminAuth().updateUser(c.uid, { displayName: v.fullName });
  return { ok: true };
}

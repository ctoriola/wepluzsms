// Server foundations: Firebase Admin connection, errors, auth context,
// role checks, audit logging and small helpers shared by every action.
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore, type DocumentReference, type Firestore, type Transaction } from "firebase-admin/firestore";
import { ZodError, type ZodTypeAny, type infer as ZInfer } from "zod";

// ----------------------------------------------------------------- errors
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
export const fail = (status: number, message: string): never => {
  throw new HttpError(status, message);
};

// ----------------------------------------------------------------- firebase
let app: App | undefined;
let firestore: Firestore | undefined;

export const usingEmulators = () => Boolean(process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST);

function parseServiceAccount(raw: string) {
  const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  try {
    return JSON.parse(text) as { project_id: string; client_email: string; private_key: string };
  } catch {
    throw new HttpError(500, "FIREBASE_SERVICE_ACCOUNT is not valid JSON (paste the whole key file, or its base64).");
  }
}

export function adminApp(): App {
  if (app) return app;
  if (getApps().length) return (app = getApps()[0]);
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) {
    const sa = parseServiceAccount(raw);
    app = initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key }), projectId: sa.project_id });
  } else if (usingEmulators()) {
    app = initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? process.env.FIREBASE_PROJECT_ID ?? "demo-wepluz" });
  } else {
    throw new HttpError(500, "The server is not configured yet: add FIREBASE_SERVICE_ACCOUNT in Vercel settings.");
  }
  return app;
}

export function db(): Firestore {
  if (!firestore) {
    firestore = getFirestore(adminApp());
    firestore.settings({ ignoreUndefinedProperties: true });
  }
  return firestore;
}
export const adminAuth = () => getAuth(adminApp());
export const now = () => FieldValue.serverTimestamp();

// ----------------------------------------------------------------- roles
export const ROLES = ["proprietor", "principal", "school_admin", "bursar", "teacher", "parent"] as const;
export type Role = (typeof ROLES)[number];
export const ADMIN_ROLES: Role[] = ["proprietor", "principal", "school_admin"];
export const STAFF_ROLES: Role[] = ["proprietor", "principal", "school_admin", "bursar", "teacher"];
export const TEACHING_ROLES: Role[] = ["proprietor", "principal", "school_admin", "teacher"];

/** proprietor (and platform admin): any role. principal / school_admin: school_admin, bursar, teacher, parent. */
export function canManageRole(actorRoles: Role[], platformAdmin: boolean, role: Role): boolean {
  if (platformAdmin || actorRoles.includes("proprietor")) return true;
  if (actorRoles.some((r) => r === "principal" || r === "school_admin")) return ["school_admin", "bursar", "teacher", "parent"].includes(role);
  return false;
}

// ----------------------------------------------------------------- context
export type Ctx = { uid: string; email: string | null; platformAdmin: boolean };

export async function authenticate(authHeader: string | undefined): Promise<Ctx | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    const token = await adminAuth().verifyIdToken(authHeader.slice(7));
    return { uid: token.uid, email: token.email ?? null, platformAdmin: token.platformAdmin === true };
  } catch {
    throw new HttpError(401, "Your session has expired. Please sign in again.");
  }
}

export function requireUser(ctx: Ctx | null): Ctx {
  if (!ctx) throw new HttpError(401, "Please sign in first.");
  return ctx;
}

export function requirePlatformAdmin(ctx: Ctx | null): Ctx {
  const c = requireUser(ctx);
  if (!c.platformAdmin) throw new HttpError(403, "Only MANDEXA platform administrators can do this.");
  return c;
}

export const schoolRef = (sid: string) => db().collection("schools").doc(sid);
export const col = (sid: string, name: string) => schoolRef(sid).collection(name);

/** Check the caller holds one of `roles` in an active school. Returns their roles there. */
export async function requireRole(ctx: Ctx | null, sid: string, roles: Role[]): Promise<{ ctx: Ctx; roles: Role[] }> {
  const c = requireUser(ctx);
  if (typeof sid !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(sid)) fail(400, "Invalid school.");
  const [school, member] = await Promise.all([schoolRef(sid).get(), col(sid, "members").doc(c.uid).get()]);
  if (!school.exists) fail(404, "School not found.");
  if (c.platformAdmin) return { ctx: c, roles: [...ADMIN_ROLES] };
  const m = member.data();
  if (!m || m.status !== "active" || school.data()?.status !== "active") fail(403, "You do not have access to this school.");
  const mine = (m!.roles ?? []) as Role[];
  if (!mine.some((r) => roles.includes(r))) fail(403, "You do not have permission to do that.");
  return { ctx: c, roles: mine };
}

// ----------------------------------------------------------------- audit
type Writer = { set(ref: DocumentReference, data: Record<string, unknown>): unknown };
type Plain = Record<string, unknown>;

function changedKeys(before: Plain, after: Plain) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((k) => k !== "updatedAt" && JSON.stringify(before[k]) !== JSON.stringify(after[k])).sort();
}

/** Record who changed what. Call with the same transaction/batch as the change itself. */
export function audit(
  w: Writer,
  sid: string,
  ctx: Ctx | null,
  e: { action: "create" | "update" | "delete"; entity: string; entityId: string; before?: Plain | null; after?: Plain | null },
) {
  // Drop timestamps and server sentinels so the log holds plain values.
  const clean = (o?: Plain | null) =>
    o ? (JSON.parse(JSON.stringify(o, (k, v) => (k === "createdAt" || k === "updatedAt" || v instanceof FieldValue ? undefined : v))) as Plain) : null;
  const before = clean(e.before);
  const after = clean(e.after);
  w.set(col(sid, "auditLog").doc(), {
    action: e.action,
    entity: e.entity,
    entityId: e.entityId,
    before,
    after,
    changedFields: before && after ? changedKeys(before, after) : null,
    actorId: ctx?.uid ?? null,
    actorEmail: ctx?.email ?? null,
    at: now(),
  });
}

// ----------------------------------------------------------------- input
export function parse<S extends ZodTypeAny>(schema: S, input: unknown): ZInfer<S> {
  try {
    return schema.parse(input);
  } catch (err) {
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      throw new HttpError(400, issue?.message && !issue.message.startsWith("Expected") && !issue.message.startsWith("Required") ? issue.message : `Invalid ${issue?.path.join(".") || "input"}.`);
    }
    throw err;
  }
}

export const nameKey = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** Normalise to E.164 (+234...). Nigerian 080... numbers become +23480... */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  const digits = trimmed.replace(/[^0-9]/g, "");
  if (!digits) return null;
  let e164: string;
  if (trimmed.startsWith("+")) e164 = `+${digits}`;
  else if (digits.startsWith("234")) e164 = `+${digits}`;
  else if (digits.startsWith("0") && digits.length === 11) e164 = `+234${digits.slice(1)}`;
  else e164 = `+${digits}`;
  return /^\+[1-9][0-9]{7,14}$/.test(e164) ? e164 : null;
}

export async function getOrFail<T = Plain>(ref: DocumentReference, what: string, tx?: Transaction): Promise<T & { id: string }> {
  const snap = tx ? await tx.get(ref) : await ref.get();
  if (!snap.exists) fail(404, `${what} not found.`);
  return { id: snap.id, ...(snap.data() as T) };
}

// Single entry point for every server action. One Vercel function serves them
// all (the free Hobby plan allows at most 12 functions).
import * as academics from "./actions/academics.js";
import * as people from "./actions/people.js";
import { brandingGet, otpRequest, otpVerify, termiiSend, type Deps } from "./actions/public.js";
import { setupInstall, setupStatus, setupSyncRules, setupUpgrade } from "./actions/setup.js";
import * as students from "./actions/students.js";
import { authenticate, HttpError, type Ctx } from "./core.js";

type Handler = (input: unknown, ctx: Ctx | null, deps: Deps) => Promise<unknown>;

export const ACTIONS: Record<string, Handler> = {
  // public
  "setup.status": () => setupStatus(),
  "setup.install": (i) => setupInstall(i),
  "branding.get": (i) => brandingGet(i),
  "otp.request": (i, c, d) => otpRequest(i, c, d),
  "otp.verify": (i) => otpVerify(i),
  // platform
  "setup.syncRules": setupSyncRules,
  "setup.upgrade": setupUpgrade,
  "schools.create": people.schoolsCreate,
  // school + people
  "schools.update": people.schoolsUpdate,
  "schools.setLogo": people.schoolsSetLogo,
  "members.invite": people.membersInvite,
  "members.setRoles": people.membersSetRoles,
  "members.setStatus": people.membersSetStatus,
  "members.remove": people.membersRemove,
  "me.setActiveSchool": people.meSetActiveSchool,
  "me.updateProfile": people.meUpdateProfile,
  // academic structure
  "sessions.create": academics.sessionsCreate,
  "sessions.update": academics.sessionsUpdate,
  "sessions.delete": academics.sessionsDelete,
  "terms.create": academics.termsCreate,
  "terms.update": academics.termsUpdate,
  "terms.delete": academics.termsDelete,
  "calendar.setCurrentTerm": academics.setCurrentTerm,
  "levels.create": academics.levelsCreate,
  "levels.update": academics.levelsUpdate,
  "levels.delete": academics.levelsDelete,
  "levels.move": academics.levelsMove,
  "levels.setSubject": academics.levelsSetSubject,
  "arms.create": academics.armsCreate,
  "arms.update": academics.armsUpdate,
  "arms.delete": academics.armsDelete,
  "subjects.create": academics.subjectsCreate,
  "subjects.update": academics.subjectsUpdate,
  "subjects.delete": academics.subjectsDelete,
  "assignments.set": academics.assignmentsSet,
  "template.apply": academics.applyTemplate,
  // students (WS2)
  "students.create": students.studentsCreate,
  "students.update": students.studentsUpdate,
  "students.setPhoto": students.studentsSetPhoto,
  "students.setMedical": students.studentsSetMedical,
  "students.changeArm": students.studentsChangeArm,
  "students.withdraw": students.studentsWithdraw,
  "students.reinstate": students.studentsReinstate,
  "students.import": students.studentsImport,
  "guardians.add": students.guardiansAdd,
  "guardians.update": students.guardiansUpdate,
  "guardians.setLink": students.guardiansSetLink,
  "guardians.unlink": students.guardiansUnlink,
  "guardians.enableLogin": students.guardiansEnableLogin,
  "promotion.run": students.promotionRun,
};

export const defaultDeps: Deps = { sendSms: termiiSend };

export async function dispatch(action: unknown, payload: unknown, authHeader: string | undefined, deps: Deps = defaultDeps) {
  if (typeof action !== "string" || !Object.prototype.hasOwnProperty.call(ACTIONS, action)) throw new HttpError(404, "Unknown action.");
  const ctx = await authenticate(authHeader);
  return ACTIONS[action](payload ?? {}, ctx, deps);
}

/** Turn any error into a safe { status, body } for the HTTP response. */
export function toErrorResponse(err: unknown) {
  if (err instanceof HttpError) return { status: err.status, body: { error: err.message } };
  const code = (err as { code?: string | number }).code;
  if (code === "auth/email-already-exists") return { status: 409, body: { error: "That email already has an account." } };
  if (code === "auth/phone-number-already-exists") return { status: 409, body: { error: "That phone number already has an account." } };
  if (code === "auth/invalid-phone-number") return { status: 400, body: { error: "Enter a valid phone number." } };
  console.error(err);
  return { status: 500, body: { error: "Something went wrong on the server. Please try again." } };
}

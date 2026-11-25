import { auth } from "./firebase";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Call a server action (api/rpc.ts). Every change to school data goes through here. */
export async function api<T = unknown>(action: string, payload: unknown = {}): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  let res: Response;
  try {
    res = await fetch("/api/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ action, payload }),
    });
  } catch {
    throw new ApiError(0, "Cannot reach the server. Check your internet connection.");
  }
  const body = (await res.json().catch(() => ({}))) as { data?: T; error?: string };
  if (!res.ok) throw new ApiError(res.status, body.error ?? "Something went wrong. Please try again.");
  return body.data as T;
}

/** Turn any error into a message a school user can act on. */
export function friendlyError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  const code = (error as { code?: string })?.code ?? "";
  const msg = error instanceof Error ? error.message : String(error ?? "");
  if (["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found", "auth/invalid-email"].includes(code)) return "Wrong email or password.";
  if (code === "auth/too-many-requests") return "Too many attempts. Please wait a few minutes and try again.";
  if (code === "auth/network-request-failed" || code === "unavailable") return "Cannot reach the server. Check your internet connection.";
  if (code === "auth/user-disabled") return "This account has been disabled. Contact your school.";
  if (code === "permission-denied") return "You do not have permission to see this.";
  return msg || "Something went wrong. Please try again.";
}

// Shared helpers for emulator tests: reset emulators, install the demo, sign in
// demo people (real ID tokens from the Auth emulator) and call server actions.
import { expect } from "vitest";
import { dispatch } from "../../server/rpc.js";

export const PROJECT = "demo-wepluz";
export const AUTH = "http://127.0.0.1:9099";
export const FS = "http://127.0.0.1:8085";
export const PASSWORD = "Password123!";
export const ACADEMY = "demo-academy";
export const GREENFIELD = "greenfield-college";

export const sentSms: { phone: string; message: string }[] = [];
const deps = { sendSms: async (phone: string, message: string) => void sentSms.push({ phone, message }) };

export async function resetEmulators() {
  await fetch(`${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: "DELETE" });
  tokens.clear();
  sentSms.length = 0;
}

export async function installDemo() {
  await resetEmulators();
  await dispatch("setup.install", { mode: "demo", setupToken: "test-setup-token" }, undefined, deps);
}

const tokens = new Map<string, string>();
export async function tokenFor(email: string, password = PASSWORD) {
  if (tokens.has(email)) return tokens.get(email)!;
  const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = (await res.json()) as { idToken?: string };
  if (!body.idToken) throw new Error(`sign-in failed for ${email}: ${JSON.stringify(body)}`);
  tokens.set(email, body.idToken);
  return body.idToken as string;
}

export const P = {
  platform: "admin@mandexa.test",
  proprietor: "proprietor@demo.test",
  principal: "principal@demo.test",
  admin: "admin@demo.test",
  bursar: "bursar@demo.test",
  teacher: "teacher1@demo.test",
  dual: "teacher2@demo.test",
  parent: "parent1@demo.test",
  gfProprietor: "proprietor@greenfield.test",
} as const;

/** Call a server action as a demo person (or anonymously with null). */
export async function call<T = any>(who: string | null, action: string, payload: unknown = {}): Promise<T> {
  const header = who ? `Bearer ${await tokenFor(who)}` : undefined;
  return (await dispatch(action, payload, header, deps)) as T;
}

/** The call must fail with this HTTP status (and message text, if given). */
export async function rejects(p: Promise<unknown>, status: number, text?: string) {
  try {
    await p;
  } catch (err) {
    const e = err as { status?: number; message: string };
    expect(e.status, `expected status ${status}, got ${e.status}: ${e.message}`).toBe(status);
    if (text) expect(e.message.toLowerCase()).toContain(text.toLowerCase());
    return;
  }
  throw new Error(`expected the call to fail with ${status}, but it succeeded`);
}

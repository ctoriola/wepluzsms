// Public actions (no sign-in): school branding for the login page, and the
// parent SMS login code (Termii) that signs parents in to Firebase.
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { adminAuth, db, fail, normalizePhone, parse } from "../core.js";

export type Deps = { sendSms: (phone: string, message: string) => Promise<void>; today: () => string };

export async function brandingGet(input: unknown) {
  const v = parse(z.object({ slug: z.string().trim().toLowerCase().max(60) }), input);
  const slug = await db().collection("slugs").doc(v.slug).get();
  if (!slug.exists) return null;
  const sid = slug.data()!.schoolId as string;
  const [school, logo] = await Promise.all([db().collection("schools").doc(sid).get(), db().doc(`schools/${sid}/assets/logo`).get()]);
  const s = school.data();
  if (!s || s.status !== "active") return null;
  return {
    name: s.name as string,
    motto: (s.settings?.motto as string | null) ?? null,
    primaryColor: s.settings?.primaryColor ?? "#14213D",
    accentColor: s.settings?.accentColor ?? "#0F766E",
    logo: (logo.data()?.dataUrl as string | undefined) ?? null,
  };
}

// ------------------------------------------------------------------ SMS login codes
const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

function secret() {
  const s = process.env.SETUP_TOKEN || process.env.OTP_SECRET;
  if (!s) fail(503, "SMS login is not set up on this server yet.");
  return s!;
}
const hmac = (value: string) => createHmac("sha256", secret()).update(value).digest();
const docFor = (phone: string) => db().collection("otpCodes").doc(hmac(`phone:${phone}`).toString("hex"));

export async function otpRequest(input: unknown, _ctx: unknown, deps: Deps) {
  const v = parse(z.object({ phone: z.string().max(30) }), input);
  const phone = normalizePhone(v.phone);
  if (!phone) fail(400, "Enter a valid phone number, for example 0803 123 4567.");
  const user = await adminAuth().getUserByPhoneNumber(phone!).catch(() => null);
  if (!user || user.disabled) fail(404, "This number is not registered with the school. Please contact the school office.");

  const ref = docFor(phone!);
  const existing = (await ref.get()).data();
  if (existing && Date.now() - (existing.sentAt as Timestamp).toMillis() < RESEND_MS) fail(429, "Please wait a minute before asking for another code.");

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  // Send first: if the SMS fails, nothing is stored and the parent can retry at once.
  await deps.sendSms(phone!, `Your Wepluz login code is ${code}. It expires in 10 minutes. Do not share this code with anyone.`);
  await ref.set({ codeHash: hmac(`code:${phone}:${code}`).toString("hex"), uid: user!.uid, attempts: 0, sentAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() + CODE_TTL_MS) });
  return { ok: true };
}

export async function otpVerify(input: unknown) {
  const v = parse(z.object({ phone: z.string().max(30), code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code.") }), input);
  const phone = normalizePhone(v.phone);
  if (!phone) fail(400, "Enter a valid phone number.");
  const ref = docFor(phone!);
  const wrong = () => fail(400, "That code is wrong or has expired. Request a new one.");

  const uid = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.data();
    if (!d || (d.expiresAt as Timestamp).toMillis() < Date.now() || d.attempts >= MAX_ATTEMPTS) wrong();
    const ok = timingSafeEqual(Buffer.from(d!.codeHash, "hex"), hmac(`code:${phone}:${v.code}`));
    if (!ok) {
      tx.update(ref, { attempts: d!.attempts + 1 });
      return null;
    }
    tx.delete(ref);
    return d!.uid as string;
  });
  if (!uid) wrong();
  return { customToken: await adminAuth().createCustomToken(uid!) };
}

/** Real SMS sender (Termii). Swapped for a fake in tests. */
export async function termiiSend(phone: string, message: string) {
  const apiKey = process.env.TERMII_API_KEY;
  const sender = process.env.TERMII_SENDER_ID;
  const base = process.env.TERMII_BASE_URL;
  if (!apiKey || !sender || !base) fail(503, "SMS login is not connected yet (Termii keys missing). Use email login for now.");
  const res = await fetch(`${base!.replace(/\/$/, "")}/api/sms/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey, to: phone.replace(/^\+/, ""), from: sender, sms: message, type: "plain", channel: process.env.TERMII_CHANNEL ?? "dnd" }),
  });
  if (!res.ok) {
    console.error(`Termii returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
    fail(502, "Could not send the SMS code. Please try again.");
  }
}

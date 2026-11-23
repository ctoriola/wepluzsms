// One-click installation: deploys the security rules and creates either the
// first platform admin (real install) or the full demo school (demo install).
// Replaces "paste the migration files". Protected by the SETUP_TOKEN secret.
import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getSecurityRules } from "firebase-admin/security-rules";
import { z } from "zod";
import { adminApp, adminAuth, db, fail, now, parse, requirePlatformAdmin, usingEmulators, type Ctx } from "../core.js";
import { seedDemo } from "../seed.js";

const configRef = () => db().collection("platform").doc("config");

export async function setupStatus() {
  const cfg = await configRef().get();
  return { installed: cfg.exists, mode: (cfg.data()?.mode as string | undefined) ?? null, configured: Boolean(process.env.SETUP_TOKEN) };
}

function checkToken(given: string) {
  const expected = process.env.SETUP_TOKEN;
  if (!expected) fail(503, "Add a SETUP_TOKEN environment variable in Vercel, redeploy, then try again.");
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected!).digest();
  if (!timingSafeEqual(a, b)) fail(403, "That setup token is not correct.");
}

/** Publish firestore.rules to the Firebase project. Skipped on the local emulator (it loads the file itself). */
export async function deployRules(): Promise<"deployed" | "emulator"> {
  if (usingEmulators()) return "emulator";
  const source = await readFile(path.join(process.cwd(), "firestore.rules"), "utf8");
  try {
    await getSecurityRules(adminApp()).releaseFirestoreRulesetFromSource(source);
  } catch (err) {
    console.error("Rules deploy failed:", err);
    fail(500, "Could not publish the security rules. Check that the service account key belongs to this Firebase project and that Firestore is created.");
  }
  return "deployed";
}

export async function setupInstall(input: unknown) {
  const v = parse(
    z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("demo"), setupToken: z.string().min(1) }),
      z.object({
        mode: z.literal("production"),
        setupToken: z.string().min(1),
        fullName: z.string().trim().min(2, "Enter your full name.").max(200),
        email: z.string().trim().toLowerCase().email("Enter a valid email address."),
        password: z.string().min(10, "Use a password of at least 10 characters."),
      }),
    ]),
    input,
  );
  checkToken(v.setupToken);
  if ((await configRef().get()).exists) fail(409, "Wepluz is already installed on this Firebase project.");

  const rules = await deployRules();

  if (v.mode === "demo") {
    await seedDemo();
  } else {
    const user = await adminAuth().createUser({ email: v.email, password: v.password, displayName: v.fullName, emailVerified: true });
    await adminAuth().setCustomUserClaims(user.uid, { platformAdmin: true });
    await db().collection("users").doc(user.uid).set({ fullName: v.fullName, email: v.email, phone: null, memberships: {}, createdAt: now() });
  }
  await configRef().set({ installedAt: now(), mode: v.mode });
  return { ok: true, rules };
}

/** Platform admins can re-publish the rules any time (also done on every Vercel build). */
export async function setupSyncRules(_input: unknown, ctx: Ctx | null) {
  requirePlatformAdmin(ctx);
  return { rules: await deployRules() };
}

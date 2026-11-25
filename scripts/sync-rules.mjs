// Runs on every Vercel build: publishes firestore.rules to your Firebase project
// so the security rules always match the deployed code. Never fails the build;
// if it cannot publish, it prints a warning (you can re-publish from /setup).
import { readFile } from "node:fs/promises";
import { cert, initializeApp } from "firebase-admin/app";
import { getSecurityRules } from "firebase-admin/security-rules";

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) {
  console.log("[rules] FIREBASE_SERVICE_ACCOUNT not set - skipping security rules publish.");
  process.exit(0);
}
try {
  const json = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  const sa = JSON.parse(json);
  const app = initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key }), projectId: sa.project_id });
  const source = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  await getSecurityRules(app).releaseFirestoreRulesetFromSource(source);
  console.log(`[rules] Published firestore.rules to ${sa.project_id}.`);
} catch (err) {
  console.warn("[rules] WARNING: could not publish security rules:", err?.message ?? err);
}

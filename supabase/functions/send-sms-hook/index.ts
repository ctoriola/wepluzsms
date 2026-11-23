// =============================================================================
// WS0 Task 0.16: Supabase Auth "Send SMS" hook -> Termii
//
// Supabase Auth generates the one-time code and calls this function instead of
// a built-in SMS provider. We verify the call really came from Supabase
// (Standard Webhooks signature) and deliver the code through Termii.
//
// Required secrets (supabase secrets set ...):
//   SEND_SMS_HOOK_SECRET  value shown when enabling the hook, e.g. "v1,whsec_..."
//   TERMII_API_KEY        from the Termii dashboard
//   TERMII_SENDER_ID      approved sender ID, e.g. WEPLUZ
//   TERMII_BASE_URL       your account's base URL from the Termii dashboard
//                         (e.g. https://api.ng.termii.com)
// Optional:
//   TERMII_CHANNEL        "dnd" (default; reaches DND-registered Nigerian numbers,
//                         must be activated on your Termii account) or "generic"
//   APP_NAME              name shown in the SMS (default "Wepluz")
//
// Deploy with JWT verification off (Supabase Auth signs the request instead):
//   supabase functions deploy send-sms-hook --no-verify-jwt
// =============================================================================
import { Webhook } from "npm:standardwebhooks@1.0.0";

type HookPayload = {
  user: { id: string; phone: string };
  sms: { otp: string };
};

function hookError(status: number, message: string): Response {
  // Format Supabase Auth expects from a hook that fails.
  return new Response(JSON.stringify({ error: { http_code: status, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return hookError(405, "Method not allowed");

  const secret = Deno.env.get("SEND_SMS_HOOK_SECRET");
  const apiKey = Deno.env.get("TERMII_API_KEY");
  const senderId = Deno.env.get("TERMII_SENDER_ID");
  const baseUrl = Deno.env.get("TERMII_BASE_URL");
  if (!secret || !apiKey || !senderId || !baseUrl) {
    console.error("send-sms-hook: missing configuration");
    return hookError(500, "SMS service is not configured");
  }

  // 1. Verify the request is genuinely from Supabase Auth.
  const rawBody = await req.text();
  let payload: HookPayload;
  try {
    const wh = new Webhook(secret.replace("v1,whsec_", ""));
    payload = wh.verify(rawBody, Object.fromEntries(req.headers)) as HookPayload;
  } catch {
    return hookError(401, "Invalid signature");
  }

  const phone = payload.user?.phone?.replace(/[^0-9]/g, "");
  const otp = payload.sms?.otp;
  if (!phone || !otp) return hookError(400, "Missing phone or code");

  // 2. Send through Termii. Never log the code itself.
  const appName = Deno.env.get("APP_NAME") ?? "Wepluz";
  const message = `Your ${appName} login code is ${otp}. It expires in 10 minutes. Do not share this code with anyone.`;

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/sms/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        to: phone,
        from: senderId,
        sms: message,
        type: "plain",
        channel: Deno.env.get("TERMII_CHANNEL") ?? "dnd",
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      console.error(`send-sms-hook: Termii returned ${res.status}: ${detail.slice(0, 300)}`);
      return hookError(502, "Could not send the SMS code. Please try again.");
    }
  } catch (err) {
    console.error("send-sms-hook: Termii request failed", err instanceof Error ? err.message : err);
    return hookError(502, "Could not send the SMS code. Please try again.");
  }

  return new Response(JSON.stringify({}), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

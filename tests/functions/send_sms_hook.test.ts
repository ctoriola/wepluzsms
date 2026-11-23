// Runs the real send-sms-hook function against a fake Termii server and checks:
//  - a correctly signed request sends the code to Termii in the right format
//  - a forged / unsigned request is rejected and nothing is sent
//  - a Termii failure is reported back to Supabase Auth as an error
// Run: deno test --allow-net --allow-env --allow-run --allow-read tests/functions/
import { Webhook } from "npm:standardwebhooks@1.0.0";

const FN_PORT = 8000; // Deno.serve() default port
const TERMII_PORT = 8766;
const SECRET_B64 = btoa("test-secret-0123456789abcdef0123");
const HOOK_SECRET = `v1,whsec_${SECRET_B64}`;

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

Deno.test("send-sms-hook delivers OTP via Termii and rejects forged calls", async () => {
  // Fake Termii
  const received: Record<string, unknown>[] = [];
  let termiiStatus = 200;
  const termii = Deno.serve({ port: TERMII_PORT, onListen() {} }, async (req) => {
    received.push(await req.json());
    return new Response(JSON.stringify({ message: "Successfully Sent" }), { status: termiiStatus });
  });

  const fnPath = new URL("../../supabase/functions/send-sms-hook/index.ts", import.meta.url).pathname;
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-net", "--allow-env", "--no-lock", fnPath],
    env: {
      DENO_DIR: Deno.env.get("DENO_DIR") ?? "",
      SEND_SMS_HOOK_SECRET: HOOK_SECRET,
      TERMII_API_KEY: "test-key",
      TERMII_SENDER_ID: "WEPLUZ",
      TERMII_BASE_URL: `http://127.0.0.1:${TERMII_PORT}`,
      APP_NAME: "Wepluz",
    },
    stdout: "null",
    stderr: "piped",
  }).spawn();

  try {
    // Wait until the function is listening
    const url = `http://127.0.0.1:${FN_PORT}/`;
    for (let i = 0; i < 100; i++) {
      try {
        await (await fetch(url, { method: "GET" })).body?.cancel();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    const payload = JSON.stringify({ user: { id: "u1", phone: "2348030000001" }, sms: { otp: "123456" } });
    const sign = (body: string) => {
      const id = `msg_${crypto.randomUUID()}`;
      const ts = new Date();
      const signature = new Webhook(SECRET_B64).sign(id, ts, body);
      return {
        "content-type": "application/json",
        "webhook-id": id,
        "webhook-timestamp": String(Math.floor(ts.getTime() / 1000)),
        "webhook-signature": signature,
      };
    };

    // 1. Valid request
    let res = await fetch(url, { method: "POST", headers: sign(payload), body: payload });
    assert(res.status === 200, `valid call should return 200, got ${res.status}`);
    await res.body?.cancel();
    assert(received.length === 1, "Termii should be called once");
    const sent = received[0];
    assert(sent.to === "2348030000001", `wrong recipient ${sent.to}`);
    assert(sent.from === "WEPLUZ", "wrong sender id");
    assert(sent.api_key === "test-key", "api key not passed");
    assert(sent.channel === "dnd", "default channel should be dnd");
    assert(String(sent.sms).includes("123456"), "code missing from SMS");
    console.log("  ok - signed request sends the code via Termii");

    // 2. Forged request (wrong signature)
    const forged = { ...sign(payload), "webhook-signature": "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" };
    res = await fetch(url, { method: "POST", headers: forged, body: payload });
    assert(res.status === 401, `forged call should return 401, got ${res.status}`);
    await res.body?.cancel();
    assert(received.length === 1, "forged call must not reach Termii");
    console.log("  ok - forged request rejected, nothing sent");

    // 3. Tampered body with an old valid signature
    const headers = sign(payload);
    const tampered = payload.replace("2348030000001", "2348099999999");
    res = await fetch(url, { method: "POST", headers, body: tampered });
    assert(res.status === 401, `tampered body should return 401, got ${res.status}`);
    await res.body?.cancel();
    console.log("  ok - tampered phone number rejected");

    // 4. Termii failure
    termiiStatus = 400;
    res = await fetch(url, { method: "POST", headers: sign(payload), body: payload });
    assert(res.status === 502, `Termii failure should return 502, got ${res.status}`);
    const errBody = await res.json();
    assert(errBody.error?.http_code === 502, "error must use the Supabase hook error format");
    console.log("  ok - Termii failure reported to Supabase Auth");
  } finally {
    child.kill();
    await child.status;
    await child.stderr.cancel();
    await termii.shutdown();
  }
});

// Vercel Function: POST /api/rpc  { action, payload }  with  Authorization: Bearer <Firebase ID token>
// Also used by the Vite dev server (see vite.config.ts), so `npm run dev` serves it locally.
import type { IncomingMessage, ServerResponse } from "node:http";
import { dispatch, toErrorResponse } from "../server/rpc.js";

type Req = IncomingMessage & { body?: unknown };

async function readBody(req: Req): Promise<Record<string, unknown>> {
  if (req.body && typeof req.body === "object") return req.body as Record<string, unknown>;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000) throw Object.assign(new Error("too large"), { status: 413 });
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export default async function handler(req: Req, res: ServerResponse) {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  let body: Record<string, unknown>;
  try {
    body = await readBody(req);
  } catch {
    return send(res, 400, { error: "Invalid request." });
  }
  try {
    const result = await dispatch(body.action, body.payload, req.headers.authorization);
    send(res, 200, { data: result ?? null });
  } catch (err) {
    const { status, body: errBody } = toErrorResponse(err);
    send(res, status, errBody);
  }
}

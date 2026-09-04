import type { MiddlewareHandler } from "hono";

import { keepBody } from "./audit.payloads.ts";
import type { KeptBody, PayloadStore } from "./audit.payloads.ts";

/** Bytes read from a body before giving up on it; a note says it was over. */
const READ_CAP = 1024 * 1024;
/** Routes whose whole body is a credential: no key rule can tell `current` from `next`. */
const CREDENTIAL_ROUTES = ["/auth/password", "/reset-password"];

type Bodied = { headers: Headers; clone(): { body: ReadableStream<Uint8Array> | null } };

function isJson(headers: Headers): boolean {
  return (headers.get("content-type") ?? "").toLowerCase().includes("application/json");
}

/**
 * Reads at most `cap` bytes and stops, so a fixture of ten megabytes costs one megabyte of memory
 * and no more; Hono's `c.json()` sets no content-length, so the size cannot be known up front.
 */
async function readUpTo(
  stream: ReadableStream<Uint8Array> | null,
  cap: number
): Promise<{ text: string; over: boolean }> {
  if (stream === null) return { text: "", over: false };
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
    if (size > cap) {
      await reader.cancel();
      return { text: "", over: true };
    }
  }
  return { text: Buffer.concat(chunks).toString("utf8"), over: false };
}

/** A JSON body under the cap is kept; anything else becomes a note. */
async function bodyOf(message: Bodied, hasBody: boolean): Promise<KeptBody> {
  if (!hasBody) return keepBody(null, null);
  const type = message.headers.get("content-type") ?? "unknown";
  if (!isJson(message.headers)) return keepBody(null, `not kept: ${type}`);
  const read = await readUpTo(message.clone().body, READ_CAP);
  if (read.over) return keepBody(null, `not kept: over ${READ_CAP} bytes`);
  return keepBody(read.text, null);
}

function requestHasBody(method: string, headers: Headers): boolean {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false;
  return headers.get("content-type") !== null || headers.get("content-length") !== null;
}

/**
 * After the handler answers, the request and the response are kept for any request that wrote an
 * audit row, redacted first (15 §15.3). The request body is read before the handler because the
 * handler consumes it; the cost is one clone of a JSON body on a mutating request. Nothing here
 * may fail the request: by the time the bodies are kept the write has happened, and a 500 now
 * would make the client retry a mutation that succeeded.
 */
export function captureAuditPayloads(
  store: PayloadStore,
  now: () => Date = () => new Date()
): MiddlewareHandler {
  return async (c, next) => {
    const method = c.req.method;
    const request = CREDENTIAL_ROUTES.some((route) => c.req.path.endsWith(route))
      ? keepBody(null, "not kept: the body is a credential")
      : await bodyOf(c.req.raw, requestHasBody(method, c.req.raw.headers));
    await next();
    const requestId = c.get("requestId");
    if (requestId === undefined) return;
    try {
      if (!store.audited(requestId)) return;
      const response = await bodyOf(c.res, c.res.status !== 204);
      store.keep({
        request_id: requestId,
        method,
        path: c.req.path,
        status: c.res.status,
        request,
        response,
        created_at: now().toISOString(),
      });
      c.get("event").merge("audit", {
        payload_kept: true,
        request_bytes: request.text?.length ?? 0,
        response_bytes: response.text?.length ?? 0,
      });
    } catch (cause) {
      c.get("event").merge("audit", { payload_kept: false, payload_error: String(cause) });
    }
  };
}

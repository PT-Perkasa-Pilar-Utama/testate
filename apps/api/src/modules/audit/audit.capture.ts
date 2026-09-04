import type { MiddlewareHandler } from "hono";

import { keepBody } from "./audit.payloads.ts";
import type { KeptBody, PayloadStore } from "./audit.payloads.ts";

/** Bodies above this are not read at all; a note says how big they were. */
const READ_CAP = 1024 * 1024;
/** Routes whose whole body is a credential: no key rule can tell `current` from `next`. */
const CREDENTIAL_ROUTES = ["/auth/password", "/reset-password"];

type Bodied = { headers: Headers; clone(): { text(): Promise<string> } };

function isJson(headers: Headers): boolean {
  return (headers.get("content-type") ?? "").toLowerCase().includes("application/json");
}

/** Reads a JSON body under the cap; anything else becomes a note without being buffered. */
async function bodyOf(message: Bodied, hasBody: boolean): Promise<KeptBody> {
  if (!hasBody) return keepBody(null, null);
  const type = message.headers.get("content-type") ?? "unknown";
  const length = Number(message.headers.get("content-length") ?? "0");
  if (!isJson(message.headers)) return keepBody(null, `not kept: ${type}, ${length} bytes`);
  if (length > READ_CAP) return keepBody(null, `not kept: ${length} bytes of JSON`);
  return keepBody(await message.clone().text(), null);
}

function requestHasBody(method: string, headers: Headers): boolean {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false;
  return headers.get("content-type") !== null || headers.get("content-length") !== null;
}

/**
 * After the handler answers, the request and the response are kept for any request that wrote an
 * audit row, redacted first (15 §15.3). The request body is read before the handler because the
 * handler consumes it; the cost is one clone of a JSON body on a mutating request.
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
    if (requestId === undefined || !store.audited(requestId)) return;
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
  };
}

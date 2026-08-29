import type { HttpMethod } from "@testate/shared";

export type OutboundRequest = {
  url: URL;
  method: HttpMethod;
  headers: Record<string, string>;
  body: string | null;
  timeoutMs: number;
  verifyTls: boolean;
  bodyCapBytes: number;
};

export type OutboundResponse = {
  status_code: number;
  response_headers: Record<string, string>;
  response_body: string;
  truncated: boolean;
  duration_ms: number;
};

export const DEFAULT_BODY_CAP = 1024 * 1024;

/** Reads at most `cap` bytes of the body; the rest is dropped and flagged (12 §12.2). */
async function readCapped(
  response: Response,
  cap: number
): Promise<{ text: string; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (reader === undefined) return { text: "", truncated: false };
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || value === undefined) break;
    if (size + value.byteLength > cap) {
      chunks.push(value.subarray(0, cap - size));
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    size += value.byteLength;
  }
  return { text: new TextDecoder().decode(Buffer.concat(chunks)), truncated };
}

/**
 * One outbound HTTP request from the server (10 §10.4): no redirects, adapter timeout, TLS verified
 * unless the adapter opts out. Throws on timeout and connection errors; any status is a result.
 */
export async function sendRequest(request: OutboundRequest): Promise<OutboundResponse> {
  const startedAt = Date.now();
  const init: RequestInit & { tls?: { rejectUnauthorized: boolean } } = {
    method: request.method,
    headers: request.headers,
    redirect: "manual",
    signal: AbortSignal.timeout(request.timeoutMs),
    tls: { rejectUnauthorized: request.verifyTls },
  };
  if (request.body !== null && request.method !== "GET") init.body = request.body;
  const response = await fetch(request.url, init);
  const { text, truncated } = await readCapped(response, request.bodyCapBytes);
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return {
    status_code: response.status,
    response_headers: headers,
    response_body: text,
    truncated,
    duration_ms: Date.now() - startedAt,
  };
}

/**
 * The only calls Testate makes to Loki (#90; L1, L2 of docs/decisions/2026-10-10-loki.md): two
 * `GET` paths, built here from a request. A redirect is refused: it would reach an address netguard
 * never checked. An `http` URL is pinned to the approved address, `https` keeps its host for TLS.
 */
import { AppError } from "../../http/index.ts";
import { pinHttpEndpoint } from "../../netguard/index.ts";

export type LokiRequest =
  | { kind: "labels"; start: bigint; end: bigint }
  | {
      kind: "query";
      query: string;
      direction: "backward" | "forward";
      limit: number;
      start: bigint;
      end?: bigint | undefined;
    };

export type LokiAnswer = { status: number; body: Buffer; capped: boolean };

export type LokiApi = { get(request: LokiRequest, capBytes: number): Promise<LokiAnswer> };

export type LokiLogin =
  | { auth: "none" }
  | { auth: "basic"; user: string; password: string }
  | { auth: "bearer"; token: string };

export type LokiConnection = {
  url: string;
  /** The address netguard approved for the URL's host. */
  address: string;
  port: number;
  login: LokiLogin;
  tenant?: string | undefined;
};

const REQUEST_TIMEOUT_MS = 30_000;

type PathAndQuery = { path: string; query: URLSearchParams };

function pathAndQuery(request: LokiRequest): PathAndQuery {
  const query = new URLSearchParams({ start: String(request.start) });
  if (request.kind === "labels") {
    query.set("end", String(request.end));
    return { path: "/loki/api/v1/labels", query };
  }
  query.set("query", request.query);
  query.set("direction", request.direction);
  query.set("limit", String(request.limit));
  if (request.end !== undefined) query.set("end", String(request.end));
  return { path: "/loki/api/v1/query_range", query };
}

/** The URL of a request under Loki's base URL, its path prefix kept. */
export function urlOf(base: string, request: LokiRequest): string {
  const { path, query } = pathAndQuery(request);
  return `${base.replace(/\/+$/, "")}${path}?${query.toString()}`;
}

function headersOf(connection: LokiConnection): Headers {
  const headers = new Headers({ Accept: "application/json" });
  const { login } = connection;
  if (login.auth === "basic")
    headers.set(
      "Authorization",
      `Basic ${Buffer.from(`${login.user}:${login.password}`).toString("base64")}`
    );
  if (login.auth === "bearer") headers.set("Authorization", `Bearer ${login.token}`);
  if (connection.tenant !== undefined) headers.set("X-Scope-OrgID", connection.tenant);
  return headers;
}

/** The body up to `capBytes`, read as a stream so an over-large answer is never held whole. */
type Body = { body: Buffer; capped: boolean };

async function bodyOf(response: Response, capBytes: number): Promise<Body> {
  const parts: Buffer[] = [];
  let size = 0;
  const reader = response.body?.getReader();
  for (
    let chunk = await reader?.read();
    chunk !== undefined && !chunk.done;
    chunk = await reader?.read()
  ) {
    parts.push(Buffer.from(chunk.value));
    size += chunk.value.length;
    if (size >= capBytes) {
      await reader?.cancel();
      return { body: Buffer.concat(parts).subarray(0, capBytes), capped: true };
    }
  }
  return { body: Buffer.concat(parts), capped: false };
}

export function createLokiApi(connection: LokiConnection): LokiApi {
  const base = pinHttpEndpoint(connection.url, connection.address, connection.port);
  const host = new URL(connection.url).host;
  return {
    async get(request, capBytes) {
      const headers = headersOf(connection);
      // A pinned http URL names the address; the virtual host still wants its name.
      if (base !== connection.url) headers.set("Host", host);
      let response: Response;
      try {
        response = await fetch(urlOf(base, request), {
          headers,
          redirect: "error",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (cause: unknown) {
        throw new AppError("ADAPTER_UNREACHABLE", `Loki did not answer: ${String(cause)}`, {
          where: host,
        });
      }
      return { status: response.status, ...(await bodyOf(response, capBytes)) };
    },
  };
}

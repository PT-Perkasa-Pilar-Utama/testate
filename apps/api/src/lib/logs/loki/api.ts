/**
 * The only calls Testate makes to Loki (#90; L1, L2 of docs/decisions/2026-10-10-loki.md): two
 * `GET` paths, built here from a request, sent through the shared pinned door (`../http.ts`).
 */
import { createPinnedHttp } from "../http.ts";
import type { HttpAnswer, HttpLogin } from "../http.ts";

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

export type LokiAnswer = HttpAnswer;

export type LokiApi = { get(request: LokiRequest, capBytes: number): Promise<LokiAnswer> };

export type LokiLogin = Exclude<HttpLogin, { auth: "api_key" }>;

export type LokiConnection = {
  url: string;
  /** The address netguard approved for the URL's host. */
  address: string;
  port: number;
  login: LokiLogin;
  tenant?: string | undefined;
};

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

export function createLokiApi(connection: LokiConnection): LokiApi {
  const headers: [string, string][] =
    connection.tenant === undefined ? [] : [["X-Scope-OrgID", connection.tenant]];
  const http = createPinnedHttp({ ...connection, headers }, "Loki");
  return {
    get(request, capBytes) {
      const { path, query } = pathAndQuery(request);
      return http.send({ method: "GET", path: `${path}?${query.toString()}` }, capBytes);
    },
  };
}

/**
 * The only calls Testate makes to Elasticsearch (#92; E1, E2 of
 * docs/decisions/2026-10-10-elasticsearch.md): `GET /` and `POST /{index}/_search`, the path built
 * here from checked index patterns and the body by Testate, through the shared pinned door.
 */
import { ES_INDEX_PART } from "@testate/shared";
import type { JsonObject } from "@testate/shared";

import { AppError } from "../../http/index.ts";
import { createPinnedHttp } from "../http.ts";
import type { HttpAnswer, HttpLogin } from "../http.ts";

export type EsRequest = { kind: "info" } | { kind: "search"; index: string; body: JsonObject };

export type EsApi = { get(request: EsRequest, capBytes: number): Promise<HttpAnswer> };

export type EsConnection = {
  url: string;
  address: string;
  port: number;
  login: HttpLogin;
  ca?: string | undefined;
};

/** `logs-*,app-*` as a path: each pattern checked again and encoded. */
export function indexPath(index: string): string {
  const parts = index.split(",").map((part) => part.trim());
  if (parts.length > 8 || !parts.every((part) => ES_INDEX_PART.test(part)))
    throw new AppError(
      "VALIDATION_ERROR",
      "that is not an index pattern Testate will send to Elasticsearch"
    );
  return parts.map(encodeURIComponent).join(",");
}

export function createEsApi(connection: EsConnection): EsApi {
  const http = createPinnedHttp(connection, "Elasticsearch");
  return {
    get(request, capBytes) {
      if (request.kind === "info") return http.send({ method: "GET", path: "/" }, capBytes);
      return http.send(
        {
          method: "POST",
          path: `/${indexPath(request.index)}/_search`,
          body: JSON.stringify(request.body),
        },
        capBytes
      );
    },
  };
}

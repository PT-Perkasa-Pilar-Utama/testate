/**
 * A checked Elasticsearch connection for an `elasticsearch` adapter (#92; E1, E7 of
 * docs/decisions/2026-10-10-elasticsearch.md): netguard and the opened secrets, as the other remote
 * log engines, then the client; and what a first look at the cluster says.
 */
import { esConfigSchema } from "@testate/shared";
import type { EngineWarning, EsConfig, FileProbeResult, JsonObject } from "@testate/shared";
import * as v from "valibot";

import { AppError } from "../../lib/http/index.ts";
import type { EsApi, EsConnection } from "../../lib/logs/elasticsearch/api.ts";
import { hitsOf, refusalOf } from "../../lib/logs/elasticsearch/parse.ts";
import { searchBody } from "../../lib/logs/elasticsearch/read.ts";
import type { HttpLogin } from "../../lib/logs/http.ts";
import type { CheckedTarget } from "../../lib/netguard/index.ts";
import { baseUrlTarget } from "./adapters.loki.ts";
import type { AdapterRecord } from "./adapters.repository.ts";
import type { Secrets } from "./adapters.secrets.ts";
import { checkedLogin } from "./adapters.shell.ts";
import type { ShellResolverDeps } from "./adapters.shell.ts";

export type OpenEs = (connection: EsConnection) => EsApi;

export type EsResolverDeps = Omit<ShellResolverDeps, "openShell"> & { openEs: OpenEs };

export type ResolvedEs = { adapter: AdapterRecord; config: EsConfig; api: EsApi };

export type EsResolver = {
  resolve(projectId: string, adapterId: string, trustAs: string | null): Promise<ResolvedEs>;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const PROBE_CAP = 1024 * 1024;

function loginOf(config: EsConfig, secrets: Secrets): HttpLogin {
  if (config.auth === "basic")
    return { auth: "basic", user: config.user ?? "", password: secrets["password"] ?? "" };
  if (config.auth === "api_key") return { auth: "api_key", key: secrets["api_key"] ?? "" };
  if (config.auth === "bearer") return { auth: "bearer", token: secrets["bearer_token"] ?? "" };
  return { auth: "none" };
}

export function connectionOf(config: EsConfig, secrets: Secrets, address: string): EsConnection {
  return {
    url: config.url,
    address,
    port: baseUrlTarget(config.url).port,
    login: loginOf(config, secrets),
    ca: config.tls_ca,
  };
}

export function createEsResolver(deps: EsResolverDeps): EsResolver {
  return {
    async resolve(projectId, adapterId, trustAs) {
      const login = await checkedLogin(deps, projectId, adapterId, "elasticsearch", trustAs);
      const config = v.parse(esConfigSchema, login.config);
      return {
        adapter: login.adapter,
        config,
        api: deps.openEs(connectionOf(config, login.secrets, login.address)),
      };
    },
  };
}

const infoSchema = v.object({
  version: v.object({ number: v.string(), distribution: v.optional(v.nullable(v.string())) }),
});

function atLeast(version: string, major: number, minor: number): boolean {
  const [got = 0, gotMinor = 0] = version.split(".").map(Number);
  return got > major || (got === major && gotMinor >= minor);
}

/** Elasticsearch 7.10 or OpenSearch 1.0, the first to sort in the nanosecond format Testate asks. */
async function checkCluster(api: EsApi): Promise<void> {
  const answer = await api.get({ kind: "info" }, PROBE_CAP);
  if (answer.status !== 200) throw refusalOf(answer);
  const { version } = v.parse(infoSchema, JSON.parse(answer.body.toString()));
  const opensearch = version.distribution === "opensearch";
  if (opensearch ? atLeast(version.number, 1, 0) : atLeast(version.number, 7, 10)) return;
  const floor = opensearch ? "OpenSearch 1.0" : "Elasticsearch 7.10";
  throw new AppError("ENGINE_UNSUPPORTED", `${version.number} is older than ${floor}`, {
    reason: "version",
  });
}

/** One document of each source over the last day: does it read, and does it match anything? */
async function sourceWarnings(api: EsApi, config: EsConfig, now: number): Promise<EngineWarning[]> {
  const warnings: EngineWarning[] = [];
  const gte = new Date(now - DAY_MS).toISOString();
  for (const source of config.sources) {
    const answer = await api.get(
      { kind: "search", index: source.index, body: searchBody(source, { gte }, "desc", 1) },
      PROBE_CAP
    );
    if (hitsOf(answer).length === 0)
      warnings.push({
        code: "no_lines",
        message: `${source.name} matched nothing in the last 24 hours, or ${source.index} matches no index`,
      });
  }
  return warnings;
}

/** Test connection: the cluster and its version, then each source's search. */
export async function probeEs(
  openEs: OpenEs,
  config: JsonObject,
  secrets: Secrets,
  target?: CheckedTarget,
  clock: () => number = Date.now
): Promise<FileProbeResult> {
  const parsed = v.parse(esConfigSchema, config);
  const api = openEs(
    connectionOf(parsed, secrets, target?.address ?? baseUrlTarget(parsed.url).host)
  );
  await checkCluster(api);
  const plaintext: EngineWarning[] = parsed.url.startsWith("http:")
    ? [
        {
          code: "plaintext",
          message: "Elasticsearch is reached over plain http: anyone on the path can read the logs",
        },
      ]
    : [];
  return {
    engine: "elasticsearch",
    tier: "logs",
    reachable: true,
    warnings: [...plaintext, ...(await sourceWarnings(api, parsed, clock()))],
  };
}

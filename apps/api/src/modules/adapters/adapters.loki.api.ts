/**
 * A checked Loki connection for a `loki` adapter (#90; L1, L7 of
 * docs/decisions/2026-10-10-loki.md): netguard and the opened secrets, as the other remote log
 * engines, then the client; and what a first look at Loki says.
 */
import { lokiConfigSchema } from "@testate/shared";
import type { EngineWarning, FileProbeResult, JsonObject, LokiConfig } from "@testate/shared";
import * as v from "valibot";

import type { LokiApi, LokiConnection, LokiLogin } from "../../lib/logs/loki/api.ts";
import { linesOf, refusalOf } from "../../lib/logs/loki/parse.ts";
import type { CheckedTarget } from "../../lib/netguard/index.ts";
import { baseUrlTarget } from "./adapters.loki.ts";
import type { AdapterRecord } from "./adapters.repository.ts";
import type { Secrets } from "./adapters.secrets.ts";
import { checkedLogin } from "./adapters.shell.ts";
import type { ShellResolverDeps } from "./adapters.shell.ts";

export type OpenLoki = (connection: LokiConnection) => LokiApi;

export type LokiResolverDeps = Omit<ShellResolverDeps, "openShell"> & { openLoki: OpenLoki };

export type ResolvedLoki = { adapter: AdapterRecord; config: LokiConfig; api: LokiApi };

export type LokiResolver = {
  resolve(projectId: string, adapterId: string, trustAs: string | null): Promise<ResolvedLoki>;
};

const DAY_NS = 24n * 60n * 60n * 1_000_000_000n;
const PROBE_CAP = 1024 * 1024;

function loginOf(config: LokiConfig, secrets: Secrets): LokiLogin {
  if (config.auth === "basic")
    return { auth: "basic", user: config.user ?? "", password: secrets["password"] ?? "" };
  if (config.auth === "bearer") return { auth: "bearer", token: secrets["bearer_token"] ?? "" };
  return { auth: "none" };
}

export function connectionOf(
  config: LokiConfig,
  secrets: Secrets,
  address: string
): LokiConnection {
  return {
    url: config.url,
    address,
    port: baseUrlTarget(config.url).port,
    login: loginOf(config, secrets),
    tenant: config.tenant,
  };
}

export function createLokiResolver(deps: LokiResolverDeps): LokiResolver {
  return {
    async resolve(projectId, adapterId, trustAs) {
      const login = await checkedLogin(deps, projectId, adapterId, "loki", trustAs);
      const config = v.parse(lokiConfigSchema, login.config);
      const api = deps.openLoki(connectionOf(config, login.secrets, login.address));
      return { adapter: login.adapter, config, api };
    },
  };
}

/** One line of each source's query over the last day: does it read, and does it match anything? */
async function sourceWarnings(
  api: LokiApi,
  config: LokiConfig,
  now: bigint
): Promise<EngineWarning[]> {
  const warnings: EngineWarning[] = [];
  for (const source of config.sources) {
    const answer = await api.get(
      {
        kind: "query",
        query: source.query,
        direction: "backward",
        limit: 1,
        start: now - DAY_NS,
        end: now,
      },
      PROBE_CAP
    );
    if (linesOf(answer).length === 0)
      warnings.push({
        code: "no_lines",
        message: `${source.name} matched nothing in the last 24 hours; a wrong tenant looks the same`,
      });
  }
  return warnings;
}

/** Test connection: Loki answers the login, then each source's query reads. */
export async function probeLoki(
  openLoki: OpenLoki,
  config: JsonObject,
  secrets: Secrets,
  target?: CheckedTarget,
  clock: () => number = Date.now
): Promise<FileProbeResult> {
  const parsed = v.parse(lokiConfigSchema, config);
  const api = openLoki(
    connectionOf(parsed, secrets, target?.address ?? baseUrlTarget(parsed.url).host)
  );
  const now = BigInt(clock()) * 1_000_000n;
  const labels = await api.get({ kind: "labels", start: now - DAY_NS, end: now }, PROBE_CAP);
  if (labels.status !== 200) throw refusalOf(labels);
  const plaintext: EngineWarning[] = parsed.url.startsWith("http:")
    ? [
        {
          code: "plaintext",
          message: "Loki is reached over plain http: anyone on the path can read the logs",
        },
      ]
    : [];
  return {
    engine: "loki",
    tier: "logs",
    reachable: true,
    warnings: [...plaintext, ...(await sourceWarnings(api, parsed, now))],
  };
}

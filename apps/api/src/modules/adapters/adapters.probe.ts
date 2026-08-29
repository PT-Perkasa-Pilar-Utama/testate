import type { Engine, FileProbeResult, JsonObject, ProbeResult } from "@testate/shared";

import * as v from "valibot";

import { toConnectionConfig } from "../../lib/engines/connection.ts";
import { AppError } from "../../lib/http/index.ts";
import { sendRequest } from "../rest/rest.client.ts";
import type { EngineRegistry } from "../../lib/engines/index.ts";
import { toAppError } from "../checkouts/checkouts.return-to-init.ts";
import { TIER_OF_ENGINE } from "./adapters.config.ts";
import { PROBE_MOCK } from "./adapters.mock.ts";
import type { Secrets } from "./adapters.secrets.ts";

/** Probes a database target; the engine cards replace this with `DbEngine.probe` (12 §12.2). */
export type ProbeFn = (
  engine: Engine,
  config: JsonObject,
  secrets: Secrets
) => Promise<ProbeResult>;

/** Probes a file store or REST base URL; the storage and rest cards replace this. */
export type FileProbeFn = (
  engine: Engine,
  config: JsonObject,
  secrets: Secrets
) => Promise<FileProbeResult>;

type Floor = { floor: string; version: string; dialect: ProbeResult["dialect"] };

const FLOORS = new Map<Engine, Floor>([
  ["postgres", { floor: "13", version: "16.3", dialect: "postgres" }],
  ["mysql", { floor: "8.0", version: "8.4.2", dialect: "mysql" }],
  ["mariadb", { floor: "10.6", version: "10.11.8", dialect: "mariadb" }],
  ["mongodb", { floor: "6.0", version: "7.0.12", dialect: "mongodb" }],
]);
const DEFAULT_FLOOR: Floor = { floor: "13", version: "16.3", dialect: "postgres" };

/** Engines in the registry probe for real; the rest fall back to the scaffold floors (12 §12.2). */
export function createEngineProbe(engines: EngineRegistry, fallback: ProbeFn): ProbeFn {
  return async (engine, config, secrets) => {
    const found = engines.get(engine);
    if (found === null) return fallback(engine, config, secrets);
    try {
      return await found.probe(toConnectionConfig(engine, config, secrets));
    } catch (cause: unknown) {
      throw toAppError(cause, "");
    }
  };
}

/**
 * SCAFFOLD: mysql, mariadb, and mongodb have no driver yet. The address check in front of this runs for real; the
 * probe answers a static capability set per engine so create, retest, and the SPA flow work end to end.
 */
export function createScaffoldProbe(): ProbeFn {
  return async (engine) => {
    const known = FLOORS.get(engine) ?? DEFAULT_FLOOR;
    return {
      ...PROBE_MOCK,
      engine,
      dialect: known.dialect,
      version: known.version,
      floor: known.floor,
      tier: TIER_OF_ENGINE[engine],
      read_only_enforcement: engine === "mongodb" ? "credential" : "transaction",
    };
  };
}

const httpProbeConfig = v.object({
  base_url: v.string(),
  timeout_ms: v.optional(v.number(), 30000),
  verify_tls: v.optional(v.boolean(), true),
});

/** REST adapters answer with any HTTP status; only a timeout or a connection error fails (10 §10.4). */
export function createHttpProbe(fallback: FileProbeFn): FileProbeFn {
  return async (engine, config, secrets) => {
    if (engine !== "http") return fallback(engine, config, secrets);
    const parsed = v.parse(httpProbeConfig, config);
    try {
      await sendRequest({
        url: new URL(parsed.base_url),
        method: "GET",
        headers: {},
        body: null,
        timeoutMs: parsed.timeout_ms,
        verifyTls: parsed.verify_tls,
        bodyCapBytes: 0,
      });
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : String(cause);
      throw new AppError("ADAPTER_UNREACHABLE", message);
    }
    const warnings: FileProbeResult["warnings"] = parsed.verify_tls
      ? []
      : [{ code: "tls_unverified", message: "TLS verification is off for this adapter" }];
    return { engine, tier: TIER_OF_ENGINE[engine], reachable: true, warnings };
  };
}

/** SCAFFOLD: the storage card opens a real connection for s3, sftp, and ftp; today the address check is the test. */
export function createScaffoldFileProbe(): FileProbeFn {
  return async (engine) => ({
    engine,
    tier: TIER_OF_ENGINE[engine],
    reachable: true,
    warnings: [],
  });
}

import type {
  Engine,
  FileProbeResult,
  JsonObject,
  ProbeOutcome,
  ProbeResult,
} from "@testate/shared";

import { toConnectionConfig } from "../../lib/engines/connection.ts";
import { AppError } from "../../lib/http/index.ts";
import type { Check, Verdict } from "../../lib/netguard/index.ts";
import type { EngineRegistry } from "../../lib/engines/index.ts";
import { toAppError } from "../checkouts/checkouts.return-to-init.ts";
import { TIER_OF_ENGINE } from "./adapters.config.ts";
import type { ValidatedConfig } from "./adapters.config.ts";
import { purposeOf, refusal } from "./adapters.helpers.ts";
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
 * Fallback for an engine name the registry lacks; every database engine has one in this build,
 * so this answers only in tests that build a smaller registry.
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

/** Fallback for a file engine outside the registry; every storage engine probes for real through `createFileProbe`. */
export function createScaffoldFileProbe(): FileProbeFn {
  return async (engine) => ({
    engine,
    tier: TIER_OF_ENGINE[engine],
    reachable: true,
    warnings: [],
  });
}

export type ProbeDeps = {
  netguard: { check(input: Check): Promise<Verdict> };
  probe: ProbeFn;
  fileProbe: FileProbeFn;
};

/**
 * The address policy first, then the engine's own probe.
 *
 * A database carries a version floor and a file store does not, which is the whole of the branch.
 * It sits out here rather than in the service so that file stays under its line count.
 */
export async function probeTarget(
  deps: ProbeDeps,
  engine: Engine,
  validated: ValidatedConfig,
  secrets: Secrets
): Promise<ProbeOutcome> {
  const verdict = await deps.netguard.check({
    ...validated.target,
    purpose: purposeOf(validated.kind),
  });
  if (!verdict.allowed) throw refusal(verdict, validated.target);
  if (validated.kind !== "database") return deps.fileProbe(engine, validated.config, secrets);
  const result = await deps.probe(engine, validated.config, secrets);
  if (!result.meets_floor) {
    throw new AppError("ENGINE_UNSUPPORTED", `${engine} ${result.version} is below the floor`, {
      floor: result.floor,
      version: result.version,
    });
  }
  return result;
}

import { inContainer } from "./adapters.hosts.ts";
import type { Adapter, AdapterDraft, EngineWarning, ProbeOutcome } from "@testate/shared";

import { AppError } from "../../lib/http/index.ts";
import type { Check, Verdict } from "../../lib/netguard/index.ts";
import type { Target } from "./adapters.config.ts";
import type { AdapterRecord, ProbeColumns, TargetShare } from "./adapters.repository.ts";
import type { Secrets } from "./adapters.secrets.ts";

/** The API shape: the sealed envelopes and the target hash never leave the module. */
export function toPublic(record: AdapterRecord): Adapter {
  const {
    config_sealed: _sealed,
    readonly_config_sealed: _readonly,
    target_hash: _hash,
    ...adapter
  } = record;
  return adapter;
}

export function purposeOf(kind: Adapter["kind"]): Check["purpose"] {
  return kind === "database" ? "database" : "files";
}

const HOST_GATEWAY = "--add-host=host.docker.internal:host-gateway";
const BY_NAME =
  "A database in another container is reached by its container name once both share a network (docker network connect)";
const BY_HOST = `one on the machine itself by host.docker.internal, which Docker on Linux defines only when Testate starts with ${HOST_GATEWAY}`;

/**
 * A name that does not resolve is nearly always Docker in the way, and the way out depends on
 * which side of it Testate runs: a container reaches a database by container name or through the
 * host alias; a native install reaches a container at this machine's address and the port it
 * publishes.
 */
export function unresolvable(host: string, contained: boolean): string {
  if (!contained) {
    return `${host} does not resolve. Testate runs outside Docker here, so a database in a container is reached at this machine's address and the port the container publishes, not by the container's name.`;
  }
  if (host.toLowerCase() === "host.docker.internal") {
    return `${host} does not resolve: Docker on Linux defines it only when Testate starts with ${HOST_GATEWAY}. ${BY_NAME}.`;
  }
  return `${host} does not resolve. ${BY_NAME}; ${BY_HOST}.`;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1"]);

/** Inside a container, loopback is the one address a person means as "this machine" and is not. */
function blocked(verdict: { reason: string }, target: Target, contained: boolean): string {
  const where = `${target.host}:${target.port} is blocked (${verdict.reason})`;
  if (!LOOPBACK.has(target.host.toLowerCase())) return where;
  if (!contained) {
    return `${where}: the deny list refuses loopback. Use this machine's own address, or an admin removes 127.0.0.0/8 from the deny list in Settings.`;
  }
  return `${where}: inside the container it is Testate itself. ${BY_NAME}; ${BY_HOST}.`;
}

/** A denied target answers HOST_BLOCKED; an unresolvable one ADAPTER_UNREACHABLE (05 §5.2). */
export function refusal(
  verdict: Exclude<Verdict, { allowed: true }>,
  target: Target,
  contained: boolean = inContainer()
): AppError {
  if (verdict.reason === "unresolvable") {
    return new AppError("ADAPTER_UNREACHABLE", unresolvable(target.host, contained), {
      reason: "dns",
      host: target.host,
    });
  }
  return new AppError("HOST_BLOCKED", blocked(verdict, target, contained), {
    reason: verdict.reason,
    matched: verdict.matched,
  });
}

/** What a probe outcome stores on the row; file probes carry no engine facts. */
export function probeColumns(outcome: ProbeOutcome, at: string): ProbeColumns {
  if ("reachable" in outcome) {
    return {
      status: "ok",
      status_message: null,
      engine_version: null,
      dialect: null,
      capabilities: null,
      strategy: null,
      read_only_enforcement: null,
      last_probe_at: at,
    };
  }
  return {
    status: "ok",
    status_message: null,
    engine_version: outcome.version,
    dialect: outcome.dialect,
    capabilities: outcome.capabilities,
    strategy: outcome.strategy,
    read_only_enforcement: outcome.read_only_enforcement,
    last_probe_at: at,
  };
}

export function readonlySecretsOf(draft: AdapterDraft): Secrets | null {
  if (draft.kind !== "database") return null;
  return draft.readonly_secrets ?? null;
}

/** Names the adapters that already track this target, in the order an operator reads them. */
export function sharedTargetWarning(shared: TargetShare[]): EngineWarning {
  const names = shared.map((item) => `${item.project_slug}/${item.name}`).join(", ");
  return {
    code: "target_shared",
    message: `${names} already tracks this database. A reset through either one rewinds the other's work.`,
  };
}

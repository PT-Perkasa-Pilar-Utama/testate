import type { Adapter, AdapterDraft, Job, ProbeOutcome } from "@testate/shared";

import { AppError } from "../../lib/http/index.ts";
import type { Check, Verdict } from "../../lib/netguard/index.ts";
import { PROJECT_JOB_MOCK } from "../projects/projects.mock.ts";
import type { Target } from "./adapters.config.ts";
import type { AdapterRecord, ProbeColumns } from "./adapters.repository.ts";
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
  if (kind === "database") return "database";
  return kind === "storage" ? "files" : "rest";
}

/** A denied target answers HOST_BLOCKED; an unresolvable one ADAPTER_UNREACHABLE (05 §5.2). */
export function refusal(verdict: Exclude<Verdict, { allowed: true }>, target: Target): AppError {
  if (verdict.reason === "unresolvable") {
    return new AppError("ADAPTER_UNREACHABLE", `${target.host} does not resolve`, {
      reason: "dns",
      host: target.host,
    });
  }
  return new AppError(
    "HOST_BLOCKED",
    `${target.host}:${target.port} is blocked (${verdict.reason})`,
    {
      reason: verdict.reason,
      matched: verdict.matched,
    }
  );
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

/** SCAFFOLD: the jobs card enqueues the init snapshot (05 §5.3 step 4); this is the queued shape. */
export function initJob(adapter: AdapterRecord): Job {
  return {
    ...PROJECT_JOB_MOCK,
    kind: "snapshot",
    status: "queued",
    project_id: adapter.project_id,
    adapter_ids: [adapter.id],
    progress: { init: true },
    result: null,
    finished_at: null,
  };
}

/** SCAFFOLD: the jobs card enqueues adapter_delete (return to init, then remove the row, 05 §5.9). */
export function deleteJob(adapter: AdapterRecord): Job {
  return {
    ...PROJECT_JOB_MOCK,
    kind: "adapter_delete",
    status: "queued",
    project_id: adapter.project_id,
    adapter_ids: [adapter.id],
    result: null,
    finished_at: null,
  };
}

export function readonlySecretsOf(draft: AdapterDraft): Secrets | null {
  if (draft.kind !== "database") return null;
  return draft.readonly_secrets ?? null;
}

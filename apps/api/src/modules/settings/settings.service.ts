import type { Actor, Job, JsonObject, JsonValue, Settings } from "@testate/shared";
import { jsonObjectSchema, settingsSchema } from "@testate/shared";
import type { updateSettingsSchema } from "@testate/shared";
import * as v from "valibot";

import type { Config } from "../../lib/config/index.ts";
import { AppError, conflict } from "../../lib/http/index.ts";
import type { RequestMeta } from "../../lib/http/auth.ts";
import type { AuditService } from "../audit/audit.service.ts";
import { PROJECT_JOB_MOCK } from "../projects/projects.mock.ts";
import type { SettingsRepository } from "./settings.repository.ts";
import { runRetention } from "./settings.retention.ts";
import type { RetentionDeps, RetentionReport } from "./settings.retention.ts";

export type SettingsPatch = v.InferOutput<typeof updateSettingsSchema>;

export type SettingsService = {
  get(): Promise<Settings>;
  update(
    actor: Actor,
    patch: SettingsPatch,
    meta: RequestMeta
  ): Promise<Settings & { disabled_adapters?: string[] }>;
  migrateStore(jobsRunning: boolean): Promise<Job>;
  backup(): Promise<Job>;
  runRetention(): Promise<RetentionReport>;
};

export type SettingsDeps = {
  repo: SettingsRepository;
  config: Pick<Config, "TESTATE_MAX_UPLOAD_MB" | "TESTATE_JOB_CONCURRENCY" | "TESTATE_STORE">;
  audit: AuditService;
  /** Re-applies the deny list to every adapter and REST target; returns the ids disabled (16 §16.2). */
  recheckDenyList: (deny: string[]) => Promise<string[]>;
  retention: Omit<RetentionDeps, "now">;
  now: () => Date;
};

/** Defaults per 06 §6.8; the environment fills the locked ones at read time. */
export const SETTINGS_DEFAULTS: Settings = {
  store: { driver: "local", s3: null, locked_by_env: false },
  retention: {
    stash_keep: 5,
    diff_days: 7,
    query_history_days: 90,
    job_history_days: 90,
    audit_days: 365,
    import_run_days: 30,
  },
  quota: { default_bytes: 10737418240, instance_ceiling_bytes: null },
  limits: {
    query_rows_default: 500,
    query_rows_max: 5000,
    query_bytes: 10485760,
    query_timeout_ms: 30000,
    query_timeout_max_ms: 300000,
    upload_mb: 50,
    token_requests_per_minute: 600,
    agent_requests_per_minute: 120,
    write_session_idle_minutes: 30,
    job_concurrency: 2,
  },
  netguard: {
    deny: ["127.0.0.0/8", "::1/128"],
    fixed: [
      "169.254.0.0/16",
      "fe80::/10",
      "169.254.169.254",
      "fd00:ec2::254",
      "metadata.google.internal",
      "self",
    ],
  },
  log: { sample_rate_by_route: {} },
  locked_by_env: ["limits.upload_mb", "limits.job_concurrency"],
};

/** `SETTINGS_MOCK` stays for the contract test and the SPA fixtures. */
export const SETTINGS_MOCK = SETTINGS_DEFAULTS;

function setPath(target: JsonObject, path: string, value: JsonValue): void {
  const parts = path.split(".");
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    const next = cursor[part];
    if (v.is(jsonObjectSchema, next)) {
      cursor = next;
      continue;
    }
    const fresh: JsonObject = {};
    cursor[part] = fresh;
    cursor = fresh;
  }
  cursor[parts.at(-1) ?? ""] = value;
}

/** Dotted keys of every leaf in a patch, for the environment-lock check and the row writes. */
export function leavesOf(patch: JsonObject, prefix = ""): [string, JsonValue][] {
  return Object.entries(patch).flatMap(([key, value]): [string, JsonValue][] => {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    const nested = !Array.isArray(value) && v.is(jsonObjectSchema, value);
    if (nested && path !== "log.sample_rate_by_route") {
      return leavesOf(value, path);
    }
    return [[path, value]];
  });
}

export function createSettingsService(deps: SettingsDeps): SettingsService {
  const nowIso = (): string => deps.now().toISOString();
  const locked = (): string[] => {
    const keys = ["limits.upload_mb", "limits.job_concurrency"];
    if (deps.config.TESTATE_STORE !== undefined) keys.push("store.driver", "store.s3");
    return keys;
  };
  const read = (): Settings => {
    const merged: JsonObject = JSON.parse(JSON.stringify(SETTINGS_DEFAULTS));
    for (const [key, value] of deps.repo.all()) setPath(merged, key, value);
    setPath(merged, "limits.upload_mb", deps.config.TESTATE_MAX_UPLOAD_MB);
    setPath(merged, "limits.job_concurrency", deps.config.TESTATE_JOB_CONCURRENCY);
    setPath(merged, "locked_by_env", locked());
    if (deps.config.TESTATE_STORE !== undefined) {
      setPath(merged, "store.driver", deps.config.TESTATE_STORE);
      setPath(merged, "store.locked_by_env", true);
    }
    return v.parse(settingsSchema, merged);
  };

  return {
    async get() {
      return read();
    },
    async update(actor, patch, meta) {
      // SCAFFOLD: S3 store settings arrive with the storage card; the local driver has nothing to set.
      if (patch.store !== undefined) {
        throw new AppError("ENGINE_UNSUPPORTED", "the S3 store is not available in this build", {
          reason: "store",
        });
      }
      const leaves = leavesOf(v.parse(jsonObjectSchema, JSON.parse(JSON.stringify(patch))));
      const blocked = leaves.find(([key]) => locked().includes(key));
      if (blocked !== undefined)
        throw conflict(`${blocked[0]} is set by the environment`, { key: blocked[0] });
      const before = read();
      for (const [key, value] of leaves) deps.repo.set(key, value, actor.id, nowIso());
      const after = read();
      deps.audit.record({
        actor,
        action: "settings.updated",
        target_type: "settings",
        target_id: "global",
        details: { keys: leaves.map(([key]) => key) },
        outcome: "succeeded",
        meta,
      });
      const denyChanged =
        JSON.stringify(before.netguard.deny) !== JSON.stringify(after.netguard.deny);
      if (!denyChanged) return after;
      const disabled = await deps.recheckDenyList(after.netguard.deny);
      deps.audit.record({
        actor,
        action: "settings.deny_list_changed",
        target_type: "settings",
        target_id: "global",
        details: { deny: after.netguard.deny, disabled_adapters: disabled },
        outcome: "succeeded",
        meta,
      });
      return { ...after, disabled_adapters: disabled };
    },
    // SCAFFOLD: store migration and backup jobs belong to the storage and ops cards (15 §15.7, 22 §22.5).
    async migrateStore(jobsRunning) {
      if (jobsRunning) throw conflict("store migration needs an idle instance");
      return {
        ...PROJECT_JOB_MOCK,
        kind: "storage_migration",
        status: "queued",
        project_id: null,
        adapter_ids: [],
        finished_at: null,
        result: null,
      };
    },
    async backup() {
      return {
        ...PROJECT_JOB_MOCK,
        kind: "backup",
        status: "queued",
        project_id: null,
        adapter_ids: [],
        finished_at: null,
        result: null,
      };
    },
    async runRetention() {
      return runRetention({ ...deps.retention, now: deps.now }, read().retention);
    },
  };
}

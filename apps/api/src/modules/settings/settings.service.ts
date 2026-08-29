import type { Actor, Job, JsonObject, JsonValue, Settings } from "@testate/shared";
import { jsonObjectSchema, settingsSchema } from "@testate/shared";
import type { storeMigrationSchema, updateSettingsSchema } from "@testate/shared";
import * as v from "valibot";

import type { Config } from "../../lib/config/index.ts";
import { AppError, conflict } from "../../lib/http/index.ts";
import type { RequestMeta } from "../../lib/http/auth.ts";
import type { Check, Verdict } from "../../lib/netguard/index.ts";
import type { KeyRing } from "../../lib/sealed/index.ts";
import type { AuditService } from "../audit/audit.service.ts";
import type { JobsService } from "../jobs/jobs.service.ts";
import { PROJECT_JOB_MOCK } from "../projects/projects.mock.ts";
import type { SettingsRepository } from "./settings.repository.ts";
import { publicStore, writeS3Settings } from "./settings.store.ts";
import { runRetention } from "./settings.retention.ts";
import type { RetentionDeps, RetentionReport } from "./settings.retention.ts";

export type SettingsPatch = v.InferOutput<typeof updateSettingsSchema>;
export type MigrationTarget = v.InferOutput<typeof storeMigrationSchema>["target"];

export type SettingsService = {
  get(): Promise<Settings>;
  update(
    actor: Actor,
    patch: SettingsPatch,
    meta: RequestMeta
  ): Promise<Settings & { disabled_adapters?: string[] }>;
  migrateStore(actor: Actor, target: MigrationTarget, meta: RequestMeta): Promise<Job>;
  backup(): Promise<Job>;
  runRetention(): Promise<RetentionReport>;
};

export type SettingsDeps = {
  repo: SettingsRepository;
  config: Pick<Config, "TESTATE_MAX_UPLOAD_MB" | "TESTATE_JOB_CONCURRENCY" | "TESTATE_STORE">;
  audit: AuditService;
  ring: KeyRing;
  jobs: Pick<JobsService, "enqueue" | "heartbeat">;
  netguard: { check(input: Check): Promise<Verdict> };
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

/** The address policy applies to the bucket endpoint as to any other outbound target (18 §18.3). */
async function assertReachable(
  netguard: SettingsDeps["netguard"],
  endpoint: string | undefined,
  region: string | undefined
): Promise<void> {
  const url = new URL(endpoint ?? `https://s3.${region ?? "us-east-1"}.amazonaws.com`);
  const defaultPort = url.protocol === "http:" ? 80 : 443;
  const port = url.port === "" ? defaultPort : Number(url.port);
  const verdict = await netguard.check({ host: url.hostname, port, purpose: "store" });
  if (!verdict.allowed)
    throw new AppError("HOST_BLOCKED", `${url.hostname} is blocked: ${verdict.reason}`, {
      host: url.hostname,
      reason: verdict.reason,
      matched: verdict.matched,
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
    const values = deps.repo.all();
    for (const [key, value] of values) if (!key.startsWith("store.")) setPath(merged, key, value);
    const driver = v.parse(
      v.optional(v.picklist(["local", "s3"]), "local"),
      values.get("store.driver")
    );
    merged["store"] = v.parse(jsonObjectSchema, publicStore(values, driver));
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
      const { store, ...rest } = patch;
      if (store !== undefined && locked().includes("store.s3"))
        throw conflict("store.s3 is set by the environment", { key: "store.s3" });
      const leaves = leavesOf(v.parse(jsonObjectSchema, JSON.parse(JSON.stringify(rest))));
      if (store !== undefined) {
        await writeS3Settings(deps.repo, deps.ring, store.s3, actor.id, nowIso());
        leaves.push(["store.s3", "updated"]);
      }
      const blocked = leaves.find(([key]) => locked().includes(key));
      if (blocked !== undefined)
        throw conflict(`${blocked[0]} is set by the environment`, { key: blocked[0] });
      const before = read();
      for (const [key, value] of leaves)
        if (key !== "store.s3") deps.repo.set(key, value, actor.id, nowIso());
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
    async migrateStore(actor, target, meta) {
      if (locked().includes("store.driver"))
        throw conflict("the store is set by the environment", { key: "store.driver" });
      const beat = deps.jobs.heartbeat();
      if (beat.running + beat.queued > 0)
        throw new AppError("JOB_IN_PROGRESS", "store migration needs an idle instance", {
          running: beat.running,
          queued: beat.queued,
        });
      if (target.driver === "s3") {
        await assertReachable(deps.netguard, target.s3.endpoint, target.s3.region);
        await writeS3Settings(
          deps.repo,
          deps.ring,
          { ...target.s3, region: target.s3.region ?? null, endpoint: target.s3.endpoint ?? null },
          actor.id,
          nowIso()
        );
      }
      return deps.jobs.enqueue({
        kind: "storage_migration",
        projectId: null,
        adapterIds: [],
        payload: { target_driver: target.driver },
        actor,
        parentRequestId: meta.request_id ?? null,
      });
    },
    // SCAFFOLD: the backup job belongs to the ops card (22 §22.5).
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

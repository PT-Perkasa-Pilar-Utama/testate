import type { Job, Settings } from "@testate/shared";

import { conflict } from "../../lib/http/index.ts";
import { PROJECT_JOB_MOCK } from "../projects/projects.mock.ts";

export const SETTINGS_MOCK: Settings = {
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

export type SettingsService = {
  get(): Promise<Settings>;
  update(patchedKeys: string[]): Promise<Settings & { disabled_adapters?: string[] }>;
  migrateStore(jobsRunning: boolean): Promise<Job>;
  backup(): Promise<Job>;
};

/** SCAFFOLD: static settings. The settings card wires the settings table and retention sweeps. */
export function createSettingsService(): SettingsService {
  return {
    async get() {
      return SETTINGS_MOCK;
    },
    async update(patchedKeys) {
      const locked = patchedKeys.find((key) => SETTINGS_MOCK.locked_by_env.includes(key));
      if (locked !== undefined)
        throw conflict(`${locked} is set by the environment`, { key: locked });
      return patchedKeys.includes("netguard.deny")
        ? { ...SETTINGS_MOCK, disabled_adapters: [] }
        : SETTINGS_MOCK;
    },
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
  };
}

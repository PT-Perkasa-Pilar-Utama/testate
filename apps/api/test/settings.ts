import type { MetadataDb } from "../src/lib/db/index.ts";
import { loadKeyRing } from "../src/lib/sealed/index.ts";
import type { AuditService } from "../src/modules/audit/audit.service.ts";
import { createSettingsRepository } from "../src/modules/settings/settings.repository.ts";
import { createSettingsService } from "../src/modules/settings/settings.service.ts";
import type { SettingsDeps, SettingsService } from "../src/modules/settings/settings.service.ts";

const RING = await loadKeyRing(
  Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64")
);

/** Jobs and the address policy that most settings tests never touch: nothing runs, everything is allowed. */
export const IDLE_SETTINGS_DEPS: Pick<SettingsDeps, "ring" | "jobs" | "netguard"> = {
  ring: RING,
  jobs: {
    enqueue: async () => {
      throw new Error("no jobs in this harness");
    },
    heartbeat: () => ({ alive: true, running: 0, queued: 0, lastTickAt: null }),
    get: async () => {
      throw new Error("no jobs in this harness");
    },
  },
  netguard: { check: async () => ({ allowed: true, addresses: ["10.0.0.9"] }) },
};

/** Real settings on the test database with the defaults and no environment locks beyond the two fixed ones. */
export function createTestSettings(
  db: MetadataDb,
  audit: AuditService,
  now: () => Date,
  extra: Pick<SettingsDeps, "ring" | "jobs" | "netguard"> = IDLE_SETTINGS_DEPS
): SettingsService {
  return createSettingsService({
    repo: createSettingsRepository(db),
    config: { TESTATE_MAX_UPLOAD_MB: 50, TESTATE_JOB_CONCURRENCY: 2, TESTATE_STORE: undefined },
    audit,
    ...extra,
    recheckDenyList: async () => [],
    retention: {
      db,
      removeState: async () => undefined,
      dataDir: `${process.cwd()}/.scratch-settings`,
    },
    now,
  });
}

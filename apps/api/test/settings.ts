import type { MetadataDb } from "../src/lib/db/index.ts";
import type { AuditService } from "../src/modules/audit/audit.service.ts";
import { createSettingsRepository } from "../src/modules/settings/settings.repository.ts";
import { createSettingsService } from "../src/modules/settings/settings.service.ts";
import type { SettingsService } from "../src/modules/settings/settings.service.ts";

/** Real settings on the test database with the defaults and no environment locks beyond the two fixed ones. */
export function createTestSettings(
  db: MetadataDb,
  audit: AuditService,
  now: () => Date
): SettingsService {
  return createSettingsService({
    repo: createSettingsRepository(db),
    config: { TESTATE_MAX_UPLOAD_MB: 50, TESTATE_JOB_CONCURRENCY: 2, TESTATE_STORE: undefined },
    audit,
    recheckDenyList: async () => [],
    retention: { db, removeState: async () => undefined },
    now,
  });
}

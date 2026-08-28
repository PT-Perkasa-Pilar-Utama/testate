import { migrate, openMetadataDb } from "../src/lib/db/index.ts";
import type { MetadataDb } from "../src/lib/db/index.ts";
import { createPasswordHasher } from "../src/lib/password/index.ts";
import type { PasswordHasher } from "../src/lib/password/index.ts";

/** A migrated in-memory metadata database; one per test file keeps tests independent. */
export function createTestDb(): MetadataDb {
  const db = openMetadataDb(":memory:");
  migrate(db);
  return db;
}

/** argon2id at the cheapest cost so a test file with a dozen logins stays under a second. */
export const TEST_HASHER: PasswordHasher = createPasswordHasher({ memoryCost: 4096, timeCost: 1 });

export type Clock = { now: () => Date; advance: (ms: number) => void };

/** A settable clock for expiry and lockout tests. */
export function createClock(start = "2026-08-28T08:00:00.000Z"): Clock {
  let current = new Date(start).getTime();
  return {
    now: () => new Date(current),
    advance: (ms) => {
      current += ms;
    },
  };
}

import * as v from "valibot";

import type { MetadataDb } from "../../lib/db/index.ts";

export type KnownHostKey = {
  key_type: string;
  fingerprint: string;
  accepted_by: string;
  accepted_at: string;
};

/** `known_host_keys` (06 §6.4): one trusted SSH key per adapter, replaced on accept. */
export type HostKeysRepository = {
  byAdapter(adapterId: string): KnownHostKey | null;
  replace(adapterId: string, key: KnownHostKey): void;
};

const hostKeyRow = v.object({
  key_type: v.string(),
  fingerprint: v.string(),
  accepted_by: v.string(),
  accepted_at: v.string(),
});

export function createHostKeysRepository(db: MetadataDb): HostKeysRepository {
  return {
    byAdapter(adapterId) {
      const row = db
        .query(
          "SELECT key_type, fingerprint, accepted_by, accepted_at FROM known_host_keys WHERE adapter_id = ?"
        )
        .get(adapterId);
      return row === null ? null : v.parse(hostKeyRow, row);
    },
    replace(adapterId, key) {
      db.transaction(() => {
        db.run("DELETE FROM known_host_keys WHERE adapter_id = ?", [adapterId]);
        db.run(
          "INSERT INTO known_host_keys (id, adapter_id, key_type, fingerprint, accepted_by, accepted_at) VALUES (?, ?, ?, ?, ?, ?)",
          [
            Bun.randomUUIDv7(),
            adapterId,
            key.key_type,
            key.fingerprint,
            key.accepted_by,
            key.accepted_at,
          ]
        );
      })();
    },
  };
}

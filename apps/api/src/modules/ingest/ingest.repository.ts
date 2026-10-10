import * as v from "valibot";

import type { MetadataDb } from "../../lib/db/index.ts";

/** One `ingest` adapter's token, hashed (I1 of docs/decisions/2026-10-10-logs-tier.md). */
const tokenSchema = v.object({
  adapter_id: v.string(),
  token_hash: v.string(),
  prefix: v.string(),
  created_at: v.string(),
  last_used_at: v.nullable(v.string()),
});
export type IngestTokenRecord = v.InferOutput<typeof tokenSchema>;

export type IngestTokensRepository = {
  byHash(hash: string): IngestTokenRecord | null;
  /** The adapter's token, replacing the one before: the old one stops at once. */
  put(record: Omit<IngestTokenRecord, "last_used_at">): void;
  touch(adapterId: string, at: string): void;
};

export function createIngestTokensRepository(db: MetadataDb): IngestTokensRepository {
  return {
    byHash(hash) {
      const row = db.query("SELECT * FROM ingest_tokens WHERE token_hash = ?").get(hash);
      return row === null ? null : v.parse(tokenSchema, row);
    },
    put(record) {
      db.query(
        `INSERT INTO ingest_tokens (adapter_id, token_hash, prefix, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (adapter_id) DO UPDATE SET token_hash = excluded.token_hash,
           prefix = excluded.prefix, created_at = excluded.created_at, last_used_at = NULL`
      ).run(record.adapter_id, record.token_hash, record.prefix, record.created_at);
    },
    touch(adapterId, at) {
      db.query("UPDATE ingest_tokens SET last_used_at = ? WHERE adapter_id = ?").run(at, adapterId);
    },
  };
}

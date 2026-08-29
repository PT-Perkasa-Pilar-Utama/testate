import type { Introspection, ManifestTable } from "@testate/shared";
import { engineWarningSchema, introspectionSchema, manifestTableSchema } from "@testate/shared";
import * as v from "valibot";

import type { MetadataDb } from "../../lib/db/index.ts";

/** One adapter's manifest inside a state (15 §15.1): the tables with their blob hashes, plus the schema. */
export type AdapterManifest = {
  adapter_id: string;
  adapter_name: string;
  engine: string;
  engine_version: string;
  fingerprint: string;
  consistency: "snapshot" | "best_effort";
  tables: ManifestTable[];
  introspection: Introspection;
  row_count: number;
  byte_count: number;
  warnings: v.InferOutput<typeof engineWarningSchema>[];
};

export type InitManifest = { state_id: string; state_name: string; manifest: AdapterManifest };

export type ManifestStore = {
  /** Records a written blob and pins it to the job until the manifest commits (15 §15.3). */
  recordBlob(hash: string, size: number, jobId: string, at: string): void;
  releasePins(jobId: string): void;
  /** One transaction: manifest rows, blob references, size; the state becomes `ready`. Returns the size. */
  commitManifest(stateId: string, manifests: AdapterManifest[], at: string): number;
  /** The latest ready `init` state that covers an adapter (13 §13.7). */
  latestInit(adapterId: string): InitManifest | null;
  /** Every adapter manifest of one state, removed adapters included (13 §13.2). */
  manifestsOf(stateId: string): AdapterManifest[];
};

const manifestRow = v.object({
  state_id: v.string(),
  state_name: v.string(),
  adapter_id: v.string(),
  adapter_name: v.string(),
  engine: v.string(),
  engine_version: v.string(),
  fingerprint: v.string(),
  consistency: v.picklist(["snapshot", "best_effort"]),
  tables: v.string(),
  introspection: v.string(),
  row_count: v.number(),
  byte_count: v.number(),
  warnings: v.string(),
});

const sizeRow = v.object({ n: v.number() });

function toManifest(parsed: v.InferOutput<typeof manifestRow>): AdapterManifest {
  return {
    adapter_id: parsed.adapter_id,
    adapter_name: parsed.adapter_name,
    engine: parsed.engine,
    engine_version: parsed.engine_version,
    fingerprint: parsed.fingerprint,
    consistency: parsed.consistency,
    tables: v.parse(v.array(manifestTableSchema), JSON.parse(parsed.tables)),
    introspection: v.parse(introspectionSchema, JSON.parse(parsed.introspection)),
    row_count: parsed.row_count,
    byte_count: parsed.byte_count,
    warnings: v.parse(v.array(engineWarningSchema), JSON.parse(parsed.warnings)),
  };
}

export function createManifestStore(db: MetadataDb): ManifestStore {
  const count = (sql: string, ...params: (string | number)[]): number =>
    v.parse(sizeRow, db.query(sql).get(...params)).n;
  return {
    recordBlob(hash, size, jobId, at) {
      db.query(
        "INSERT OR IGNORE INTO blobs (hash, size_bytes, ref_count, created_at) VALUES (?, ?, 0, ?)"
      ).run(hash, size, at);
      db.query("INSERT OR IGNORE INTO blob_pins (blob_hash, job_id) VALUES (?, ?)").run(
        hash,
        jobId
      );
    },
    releasePins(jobId) {
      db.query("DELETE FROM blob_pins WHERE job_id = ?").run(jobId);
    },
    commitManifest(stateId, manifests, at) {
      return db.transaction(() => {
        const hashes = new Set<string>();
        for (const manifest of manifests) {
          db.query(
            `INSERT INTO state_adapters (state_id, adapter_id, adapter_name, engine, engine_version, fingerprint,
               consistency, removed, tables, introspection, row_count, byte_count, warnings)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`
          ).run(
            stateId,
            manifest.adapter_id,
            manifest.adapter_name,
            manifest.engine,
            manifest.engine_version,
            manifest.fingerprint,
            manifest.consistency,
            JSON.stringify(manifest.tables),
            JSON.stringify(manifest.introspection),
            manifest.row_count,
            manifest.byte_count,
            JSON.stringify(manifest.warnings)
          );
          for (const table of manifest.tables) {
            db.query("UPDATE blobs SET ref_count = ref_count + 1 WHERE hash = ?").run(
              table.blob_hash
            );
            hashes.add(table.blob_hash);
          }
        }
        for (const hash of hashes) {
          db.query("INSERT OR IGNORE INTO state_blobs (state_id, blob_hash) VALUES (?, ?)").run(
            stateId,
            hash
          );
        }
        const size = count(
          "SELECT COALESCE(SUM(b.size_bytes), 0) AS n FROM state_blobs sb JOIN blobs b ON b.hash = sb.blob_hash WHERE sb.state_id = ?",
          stateId
        );
        db.query(
          "UPDATE states SET status = 'ready', size_bytes = ?, updated_at = ? WHERE id = ?"
        ).run(size, at, stateId);
        return size;
      })();
    },
    latestInit(adapterId) {
      const row = db
        .query(
          `SELECT s.id AS state_id, s.name AS state_name, sa.*
           FROM state_adapters sa JOIN states s ON s.id = sa.state_id
           WHERE sa.adapter_id = ? AND s.kind = 'init' AND s.status = 'ready' AND sa.removed = 0
           ORDER BY s.created_at DESC, s.id DESC LIMIT 1`
        )
        .get(adapterId);
      if (row === null) return null;
      const parsed = v.parse(manifestRow, row);
      return {
        state_id: parsed.state_id,
        state_name: parsed.state_name,
        manifest: toManifest(parsed),
      };
    },
    manifestsOf(stateId) {
      const rows = db
        .query(
          `SELECT s.id AS state_id, s.name AS state_name, sa.* FROM state_adapters sa
           JOIN states s ON s.id = sa.state_id WHERE sa.state_id = ? ORDER BY sa.adapter_name`
        )
        .all(stateId);
      return v.parse(v.array(manifestRow), rows).map(toManifest);
    },
  };
}

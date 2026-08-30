import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import type { JsonObject } from "@testate/shared";
import * as v from "valibot";

import type { BlobStore } from "../../lib/blobstore/index.ts";
import type { MetadataDb } from "../../lib/db/index.ts";
import type { KeyRing } from "../../lib/sealed/index.ts";
import { writeTar } from "../../lib/snapshot/tar.ts";
import type { TarEntry } from "../../lib/snapshot/tar.ts";
import type { AuditService } from "../audit/audit.service.ts";
import type { JobRunner } from "../jobs/jobs.dispatcher.ts";

export type BackupDeps = {
  db: MetadataDb;
  dataDir: string;
  version: string;
  ring: KeyRing;
  live: BlobStore;
  referencedBlobs: () => string[];
  audit: AuditService;
  now: () => Date;
};

export const backupPayloadSchema = v.object({
  include_blobs: v.boolean(),
  destination: v.picklist(["download", "store"]),
});

/** Download backups live under `run/backups/<job>.tar` for 24 hours (16 §16.4). */
export const BACKUP_TTL_MS = 24 * 60 * 60 * 1000;

export function backupPath(dataDir: string, jobId: string): string {
  return join(dataDir, "run", "backups", `${jobId}.tar`);
}

function bytesEntry(name: string, bytes: Uint8Array): TarEntry {
  return { name, body: new Blob([bytes]).stream(), size: bytes.byteLength };
}

async function* entriesOf(
  deps: BackupDeps,
  manifest: Uint8Array,
  dbPath: string,
  hashes: string[]
): AsyncIterable<TarEntry> {
  yield bytesEntry("manifest.json", manifest);
  yield { name: "metadata.db", body: Bun.file(dbPath).stream(), size: statSync(dbPath).size };
  for (const hash of hashes) {
    const stat = await deps.live.stat(hash);
    if (stat === null) throw new Error(`blob ${hash} is referenced but missing from the store`);
    yield { name: `blobs/${hash}`, body: deps.live.get(hash), size: stat.size };
  }
}

/**
 * The `backup` job (22 §22.5): consistent SQLite copy through VACUUM INTO, a manifest naming the
 * key fingerprints the sealed values need, optionally every referenced blob, as one PAX tar.
 */
export function createBackupRunner(deps: BackupDeps): JobRunner {
  return async ({ job, progress }) => {
    const payload = v.parse(backupPayloadSchema, job.payload);
    const runDir = join(deps.dataDir, "run");
    mkdirSync(join(runDir, "backups"), { recursive: true });
    const dbCopy = join(runDir, `backup-${job.id}.db`);
    rmSync(dbCopy, { force: true });
    progress({ phase: "metadata" });
    deps.db.exec(`VACUUM INTO '${dbCopy.replace(/'/g, "''")}'`);
    try {
      const hashes = payload.include_blobs ? deps.referencedBlobs() : [];
      let blobBytes = 0;
      for (const hash of hashes) blobBytes += (await deps.live.stat(hash))?.size ?? 0;
      const createdAt = deps.now().toISOString();
      const manifest = new TextEncoder().encode(
        JSON.stringify({
          version: 1,
          testate_version: deps.version,
          created_at: createdAt,
          key_fingerprints: [...deps.ring.all.keys()],
          include_blobs: payload.include_blobs,
          blob_count: hashes.length,
          blob_bytes: blobBytes,
        })
      );
      progress({ phase: "tar", blobs: hashes.length });
      const tar = writeTar(entriesOf(deps, manifest, dbCopy, hashes));
      const result = await deliver(deps, job.id, payload.destination, tar, createdAt);
      deps.audit.record({
        actor: job.actor,
        action: "backup.created",
        target_type: "backup",
        target_id: job.id,
        details: { ...result, include_blobs: payload.include_blobs },
        outcome: "succeeded",
      });
      return {
        status: "succeeded",
        result: { ...result, key_fingerprints: [...deps.ring.all.keys()] },
      };
    } finally {
      rmSync(dbCopy, { force: true });
    }
  };
}

async function deliver(
  deps: BackupDeps,
  jobId: string,
  destination: "download" | "store",
  tar: ReadableStream<Uint8Array>,
  createdAt: string
): Promise<JsonObject> {
  if (destination === "download") {
    const path = backupPath(deps.dataDir, jobId);
    // Bun.write(path, Response(stream)) stalls on pull-based streams; write chunk by chunk.
    const writer = Bun.file(path).writer();
    for await (const chunk of tar) writer.write(chunk);
    await writer.end();
    return {
      size_bytes: statSync(path).size,
      download_available_until: new Date(Date.parse(createdAt) + BACKUP_TTL_MS).toISOString(),
    };
  }
  // ponytail: the store is content-addressed, so the backup lands under blobs/<hash> and the
  // result names that key. 22 §22.5 wrote `backups/<timestamp>.tar`; add a keyed put if needed.
  const stored = await deps.live.put(tar, {});
  return { size_bytes: stored.size, store_key: `blobs/${stored.hash.slice(0, 2)}/${stored.hash}` };
}

/** Removes download backups past their 24-hour window; the retention sweep calls this daily. */
export function pruneBackups(dataDir: string, now: Date): number {
  const dir = join(dataDir, "run", "backups");
  if (!existsSync(dir)) return 0;
  let removed = 0;
  for (const name of readdirSync(dir).filter((item) => item.endsWith(".tar"))) {
    const path = join(dir, name);
    if (now.getTime() - statSync(path).mtimeMs <= BACKUP_TTL_MS) continue;
    rmSync(path, { force: true });
    removed += 1;
  }
  return removed;
}

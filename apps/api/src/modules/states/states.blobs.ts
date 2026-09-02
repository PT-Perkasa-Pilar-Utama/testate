import * as v from "valibot";

import type { MetadataDb } from "../../lib/db/index.ts";

/**
 * The reference counting behind a state's blobs, and the two deletes that spend it.
 *
 * A blob is content-addressed and shared: two states that hold the same table hold the same blob,
 * and `blobs.ref_count` is how many manifest entries point at it. Everything here either takes
 * references off or asks which hashes are left with none, and getting that wrong in either
 * direction is expensive: too eager and a live state reads a file that is gone, too shy and the
 * disk fills with blobs nothing can name.
 */
export type BlobAccounting = {
  /** Takes this state's references off, in whatever transaction the caller is already in. */
  releaseState(db: MetadataDb, stateId: string): string[];
  /** The same, for every state of a project. */
  releaseProject(db: MetadataDb, projectId: string): string[];
};

const refRow = v.object({ blob_hash: v.string(), refs: v.number() });

function release(db: MetadataDb, sql: string, id: string): string[] {
  const hashes = v.parse(v.array(refRow), db.query(sql).all(id));
  for (const item of hashes) {
    db.query("UPDATE blobs SET ref_count = MAX(ref_count - ?, 0) WHERE hash = ?").run(
      item.refs,
      item.blob_hash
    );
  }
  return hashes.map((item) => item.blob_hash);
}

export const blobAccounting: BlobAccounting = {
  releaseState: (db, stateId) =>
    release(
      db,
      `SELECT j.value ->> 'blob_hash' AS blob_hash, COUNT(*) AS refs
       FROM state_adapters sa, json_each(sa.tables) j WHERE sa.state_id = ? GROUP BY blob_hash`,
      stateId
    ),
  releaseProject: (db, projectId) =>
    release(
      db,
      `SELECT j.value ->> 'blob_hash' AS blob_hash, COUNT(*) AS refs
       FROM state_adapters sa
       JOIN states s ON s.id = sa.state_id, json_each(sa.tables) j
       WHERE s.project_id = ? GROUP BY blob_hash`,
      projectId
    ),
};

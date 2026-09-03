import type {
  Actor,
  State,
  StateDetail,
  StateKind,
  StateListItem,
  StateStatus,
} from "@testate/shared";
import * as v from "valibot";
import { createdRangeConditions } from "../../lib/db/date-range.ts";
import { keysetCondition } from "../../lib/db/keyset.ts";

import type { MetadataDb } from "../../lib/db/index.ts";
import { blobAccounting } from "./states.blobs.ts";
import { eventsOf } from "./states.events.ts";
import { createManifestStore } from "./states.manifests.ts";
import type { ManifestStore } from "./states.manifests.ts";
import {
  STATE_SELECT,
  adapterRowSchema,
  stateRowSchema,
  toState,
  toStateDetail,
} from "./states.rows.ts";
import type { AdapterRow, StateRow } from "./states.rows.ts";

export type StatesFilter = {
  limit: number;
  sort: "created_at" | "name" | "size_bytes";
  order: "asc" | "desc";
  kind?: StateKind;
  tag?: string;
  name?: string;
  protected?: boolean;
  created_from?: string;
  created_to?: string;
  includeStash: boolean;
  cursor?: string;
};

export type StatePatch = {
  name?: string;
  notes?: string | null;
  tags?: string[];
  protected?: boolean;
  kind?: StateKind;
  job_id?: string;
};

export type Removal = { orphans: string[]; wasHead: boolean };

export type StatesRepository = StateRows & ManifestStore;

export type { AdapterManifest, InitManifest } from "./states.manifests.ts";

export type NewState = {
  id: string;
  project_id: string;
  name: string;
  kind: StateKind;
  protected: boolean;
  parent_state_id: string | null;
  stash_reason?: "checkout" | "import" | "write-session";
  job_id: string;
  actor: Actor;
  created_at: string;
};

export type StateRows = {
  insert(state: NewState): void;
  /** `diff` states never list (08 §8); stashes only on request. */
  list(projectId: string, filter: StatesFilter): StateListItem[];
  byIdOrName(projectId: string, idOrName: string): State | null;
  /** The state a job created; a replayed `Idempotency-Key` answers with it (09 §9.3). */
  byJobId(projectId: string, jobId: string): State | null;
  detail(projectId: string, idOrName: string): StateDetail | null;
  update(id: string, patch: StatePatch, at: string): void;
  /** Deletes the state, decrements blob references, and names the blobs left with none (15 §15.4). */
  remove(id: string): Removal;
  /**
   * Deletes a project and every blob reference its states held, in one transaction.
   *
   * The project row alone cascades the states away, and that was the whole of a project delete
   * until now: the manifests went, `blobs.ref_count` did not, and every blob those states pinned
   * stayed on disk with nobody left to name it.
   *
   * One transaction, not two statements, and the order is the reason. Decrementing and then
   * deleting as separate steps leaves a window where a crash keeps the states with refs already
   * taken off them; the next state delete floors those counts to zero and the sweep removes files
   * a live state still reads from. Deleting files is the caller's, after this commits.
   */
  removeProject(projectId: string): string[];
  /** Blobs with no reference and no pin; the caller deletes them from the store. */
  unpinnedOrphans(hashes: string[]): string[];
  /** Every blob some state or diff still references; the store migration copies exactly these. */
  referencedBlobs(): string[];
  forgetBlobs(hashes: string[]): void;
  nameTaken(projectId: string, name: string): boolean;
  setStatus(id: string, status: StateStatus, at: string): void;
};

const countRow = v.object({ n: v.number() });

const SORT_COLUMNS = {
  created_at: "s.created_at",
  name: "s.name COLLATE NOCASE",
  size_bytes: "s.size_bytes",
} as const;

type Condition = { sql: string; params: (string | number)[] };

function conditions(projectId: string, filter: StatesFilter): Condition[] {
  const found: Condition[] = [
    { sql: "s.project_id = ?", params: [projectId] },
    { sql: "s.kind <> 'diff'", params: [] },
  ];
  if (!filter.includeStash) found.push({ sql: "s.kind <> 'stash'", params: [] });
  if (filter.kind !== undefined) found.push({ sql: "s.kind = ?", params: [filter.kind] });
  if (filter.name !== undefined) found.push({ sql: "s.name = ?", params: [filter.name] });
  if (filter.protected !== undefined) {
    found.push({ sql: "s.protected = ?", params: [filter.protected ? 1 : 0] });
  }
  if (filter.tag !== undefined) {
    found.push({
      sql: "EXISTS (SELECT 1 FROM json_each(s.tags) WHERE json_each.value = ?)",
      params: [filter.tag],
    });
  }
  found.push(...createdRangeConditions("s.created_at", filter.created_from, filter.created_to));
  return found;
}

function createStateRows(db: MetadataDb): StateRows {
  const count = (sql: string, ...params: (string | number)[]): number =>
    v.parse(countRow, db.query(sql).get(...params)).n;
  const adaptersOf = (stateIds: string[]): Map<string, AdapterRow[]> => {
    const byState = new Map<string, AdapterRow[]>();
    if (stateIds.length === 0) return byState;
    const marks = stateIds.map(() => "?").join(", ");
    const rows = v.parse(
      v.array(adapterRowSchema),
      db
        .query(`SELECT * FROM state_adapters WHERE state_id IN (${marks}) ORDER BY adapter_name`)
        .all(...stateIds)
    );
    for (const row of rows) byState.set(row.state_id, [...(byState.get(row.state_id) ?? []), row]);
    return byState;
  };
  const oneRow = (projectId: string, idOrName: string): StateRow | null => {
    const row = db
      .query(`${STATE_SELECT} WHERE s.project_id = ? AND (s.id = ? OR s.name = ?) LIMIT 1`)
      .get(projectId, idOrName, idOrName);
    return row === null ? null : v.parse(stateRowSchema, row);
  };
  return {
    list(projectId, filter) {
      const found = conditions(projectId, filter);
      const order = `${SORT_COLUMNS[filter.sort]} ${filter.order === "desc" ? "DESC" : "ASC"}, s.id ASC`;
      const after = keysetCondition(
        {
          column: SORT_COLUMNS[filter.sort],
          id: "s.id",
          sort: filter.sort,
          order: filter.order,
          idOrder: "asc",
        },
        filter.cursor
      );
      if (after !== null) found.push(after);
      const rows = v.parse(
        v.array(stateRowSchema),
        db
          .query(
            `${STATE_SELECT} WHERE ${found.map((item) => item.sql).join(" AND ")} ORDER BY ${order} LIMIT ?`
          )
          .all(...found.flatMap((item) => item.params), filter.limit)
      );
      const ids = rows.map((row) => row.id);
      const adapters = adaptersOf(ids);
      const events = eventsOf(db, ids);
      return rows.map((row) => {
        const counted = events.get(row.id) ?? { checkouts: 0, diffs: 0 };
        return {
          ...toState(row, adapters.get(row.id) ?? []),
          checkout_count: counted.checkouts,
          diff_count: counted.diffs,
        };
      });
    },
    byIdOrName(projectId, idOrName) {
      const row = oneRow(projectId, idOrName);
      return row === null ? null : toState(row, adaptersOf([row.id]).get(row.id) ?? []);
    },
    byJobId(projectId, jobId) {
      const found = db
        .query(`${STATE_SELECT} WHERE s.project_id = ? AND s.job_id = ? LIMIT 1`)
        .get(projectId, jobId);
      if (found === null) return null;
      const row = v.parse(stateRowSchema, found);
      return toState(row, adaptersOf([row.id]).get(row.id) ?? []);
    },
    detail(projectId, idOrName) {
      const row = oneRow(projectId, idOrName);
      if (row === null) return null;
      // The parent's manifests ride along in the same query: the detail says what changed.
      const parentId = row.parent_state_id;
      const byState = adaptersOf(parentId === null ? [row.id] : [row.id, parentId]);
      return toStateDetail(
        row,
        byState.get(row.id) ?? [],
        parentId === null ? null : (byState.get(parentId) ?? [])
      );
    },
    update(id, patch, at) {
      const sets: string[] = ["updated_at = ?"];
      const params: (string | number | null)[] = [at];
      if (patch.name !== undefined) {
        sets.push("name = ?");
        params.push(patch.name);
      }
      if (patch.notes !== undefined) {
        sets.push("notes = ?");
        params.push(patch.notes);
      }
      if (patch.tags !== undefined) {
        sets.push("tags = ?");
        params.push(JSON.stringify(patch.tags));
      }
      if (patch.protected !== undefined) {
        sets.push("protected = ?");
        params.push(patch.protected ? 1 : 0);
      }
      if (patch.kind !== undefined) {
        sets.push("kind = ?");
        params.push(patch.kind);
      }
      if (patch.job_id !== undefined) {
        sets.push("job_id = ?");
        params.push(patch.job_id);
      }
      db.query(`UPDATE states SET ${sets.join(", ")} WHERE id = ?`).run(...params, id);
    },
    remove(id) {
      return db.transaction((): Removal => {
        const orphans = blobAccounting.releaseState(db, id);
        const wasHead =
          db
            .query(
              "UPDATE projects SET head_state_id = NULL, head_status = 'none' WHERE head_state_id = ?"
            )
            .run(id).changes > 0;
        db.query("DELETE FROM states WHERE id = ?").run(id);
        return { orphans, wasHead };
      })();
    },
    removeProject(projectId) {
      return db.transaction((): string[] => {
        const orphans = blobAccounting.releaseProject(db, projectId);
        db.query("DELETE FROM projects WHERE id = ?").run(projectId);
        return orphans;
      })();
    },
    referencedBlobs() {
      return v
        .parse(
          v.array(v.object({ hash: v.string() })),
          db.query("SELECT hash FROM blobs WHERE ref_count > 0 ORDER BY hash").all()
        )
        .map((row) => row.hash);
    },
    unpinnedOrphans(hashes) {
      return hashes.filter(
        (hash) =>
          count(
            `SELECT COUNT(*) AS n FROM blobs b WHERE b.hash = ? AND b.ref_count = 0
             AND NOT EXISTS (SELECT 1 FROM blob_pins p WHERE p.blob_hash = b.hash)`,
            hash
          ) === 1
      );
    },
    forgetBlobs(hashes) {
      for (const hash of hashes) db.query("DELETE FROM blobs WHERE hash = ?").run(hash);
    },
    insert(state) {
      db.query(
        `INSERT INTO states (id, project_id, name, kind, status, protected, notes, tags, parent_state_id,
           stash_reason, job_id, actor_user_id, actor_token_id, size_bytes, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'creating', ?, NULL, '[]', ?, ?, ?, ?, ?, 0, ?, ?)`
      ).run(
        state.id,
        state.project_id,
        state.name,
        state.kind,
        state.protected ? 1 : 0,
        state.parent_state_id,
        state.stash_reason ?? null,
        state.job_id,
        state.actor.kind === "user" ? state.actor.id : null,
        state.actor.kind === "token" ? state.actor.id : null,
        state.created_at,
        state.created_at
      );
    },
    nameTaken: (projectId, name) =>
      count("SELECT COUNT(*) AS n FROM states WHERE project_id = ? AND name = ?", projectId, name) >
      0,
    setStatus(id, status, at) {
      db.query("UPDATE states SET status = ?, updated_at = ? WHERE id = ?").run(status, at, id);
    },
  };
}

export function createStatesRepository(db: MetadataDb): StatesRepository {
  return { ...createStateRows(db), ...createManifestStore(db) };
}

import type { Actor, State, StateDetail, StateKind, StateStatus } from "@testate/shared";
import * as v from "valibot";

import type { MetadataDb } from "../../lib/db/index.ts";
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
  includeStash: boolean;
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
  job_id: string;
  actor: Actor;
  created_at: string;
};

export type StateRows = {
  insert(state: NewState): void;
  /** `diff` states never list (08 §8); stashes only on request. ponytail: no cursor, ceiling ~1000 states per project. */
  list(projectId: string, filter: StatesFilter): State[];
  byIdOrName(projectId: string, idOrName: string): State | null;
  detail(projectId: string, idOrName: string): StateDetail | null;
  update(id: string, patch: StatePatch, at: string): void;
  /** Deletes the state, decrements blob references, and names the blobs left with none (15 §15.4). */
  remove(id: string): Removal;
  /** Blobs with no reference and no pin; the caller deletes them from the store. */
  unpinnedOrphans(hashes: string[]): string[];
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
      const rows = v.parse(
        v.array(stateRowSchema),
        db
          .query(
            `${STATE_SELECT} WHERE ${found.map((item) => item.sql).join(" AND ")} ORDER BY ${order} LIMIT ?`
          )
          .all(...found.flatMap((item) => item.params), filter.limit)
      );
      const adapters = adaptersOf(rows.map((row) => row.id));
      return rows.map((row) => toState(row, adapters.get(row.id) ?? []));
    },
    byIdOrName(projectId, idOrName) {
      const row = oneRow(projectId, idOrName);
      return row === null ? null : toState(row, adaptersOf([row.id]).get(row.id) ?? []);
    },
    detail(projectId, idOrName) {
      const row = oneRow(projectId, idOrName);
      return row === null ? null : toStateDetail(row, adaptersOf([row.id]).get(row.id) ?? []);
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
        const hashes = v.parse(
          v.array(v.object({ blob_hash: v.string(), refs: v.number() })),
          db
            .query(
              `SELECT sa.tables AS tables_json, j.value ->> 'blob_hash' AS blob_hash, COUNT(*) AS refs
               FROM state_adapters sa, json_each(sa.tables) j WHERE sa.state_id = ? GROUP BY blob_hash`
            )
            .all(id)
        );
        for (const item of hashes) {
          db.query("UPDATE blobs SET ref_count = MAX(ref_count - ?, 0) WHERE hash = ?").run(
            item.refs,
            item.blob_hash
          );
        }
        const wasHead =
          db
            .query(
              "UPDATE projects SET head_state_id = NULL, head_status = 'none' WHERE head_state_id = ?"
            )
            .run(id).changes > 0;
        db.query("DELETE FROM states WHERE id = ?").run(id);
        return { orphans: hashes.map((item) => item.blob_hash), wasHead };
      })();
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
           job_id, actor_user_id, actor_token_id, size_bytes, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'creating', ?, NULL, '[]', ?, ?, ?, ?, 0, ?, ?)`
      ).run(
        state.id,
        state.project_id,
        state.name,
        state.kind,
        state.protected ? 1 : 0,
        state.parent_state_id,
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

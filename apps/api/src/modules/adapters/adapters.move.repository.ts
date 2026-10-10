import * as v from "valibot";

import type { MetadataDb } from "../../lib/db/index.ts";
import type { AdapterMode } from "@testate/shared";

/** What stops a move now (M6 of docs/decisions/2026-10-10-move-adapter.md). */
export type MoveBlockers = { job: boolean; session: boolean };

export type MoveRepository = {
  blockers(adapterId: string, projectId: string): MoveBlockers;
  /**
   * Moves the adapter and marks its manifests removed in the old project's states, in one
   * transaction (M2, ADR 0005). Returns how many manifests it marked.
   */
  moveTo(
    adapterId: string,
    move: { from: string; to: string; mode: AdapterMode; at: string }
  ): number;
};

const countRow = v.object({ n: v.number() });

export function createMoveRepository(db: MetadataDb): MoveRepository {
  const count = (sql: string, ...params: string[]): number =>
    v.parse(countRow, db.query(sql).get(...params)).n;
  return {
    blockers(adapterId, projectId) {
      return {
        job:
          count(
            "SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued', 'running') AND project_id = ?",
            projectId
          ) > 0,
        session:
          count(
            "SELECT COUNT(*) AS n FROM write_sessions WHERE adapter_id = ? AND ended_at IS NULL",
            adapterId
          ) > 0,
      };
    },
    moveTo(adapterId, move) {
      return db.transaction(() => {
        const marked = db
          .query(
            `UPDATE state_adapters SET removed = 1
             WHERE adapter_id = ? AND removed = 0
               AND state_id IN (SELECT id FROM states WHERE project_id = ?)`
          )
          .run(adapterId, move.from).changes;
        db.query("UPDATE adapters SET project_id = ?, mode = ?, updated_at = ? WHERE id = ?").run(
          move.to,
          move.mode,
          move.at,
          adapterId
        );
        return marked;
      })();
    },
  };
}

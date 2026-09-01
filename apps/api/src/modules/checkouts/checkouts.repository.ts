import type { Actor, Checkout } from "@testate/shared";
import * as v from "valibot";
import { keysetCondition } from "../../lib/db/keyset.ts";
import { FROM, SORT_COLUMNS, conditions } from "./checkouts.query.ts";
import { ADAPTERS, SELECT, adapterRow, checkoutRow, toCheckout } from "./checkouts.rows.ts";

import type { CounterResult } from "../../lib/engines/index.ts";
import type { MetadataDb } from "../../lib/db/index.ts";
import type { AdapterOutcome } from "./checkouts.restore.ts";

export type NewCheckout = {
  id: string;
  project_id: string;
  state_id: string;
  job_id: string;
  force: boolean;
  purpose: Checkout["purpose"];
  adapter_ids: string[];
  actor: Actor;
  created_at: string;
};

export type CheckoutSort = "created_at" | "state" | "status" | "actor";

export type CheckoutsFilter = {
  limit: number;
  sort: CheckoutSort;
  order: "asc" | "desc";
  status?: Checkout["status"];
  state_id?: string;
  purpose?: Checkout["purpose"];
  q?: string;
  created_from?: string;
  created_to?: string;
  cursor?: string;
};

export type AdapterCounters = { adapter_id: string; counters: CounterResult[] };

export type CheckoutsRepository = {
  insert(checkout: NewCheckout): void;
  byId(projectId: string, id: string): Checkout | null;
  /** The checkout a job belongs to; a replayed `Idempotency-Key` answers with it (09 §9.3). */
  byJobId(projectId: string, jobId: string): Checkout | null;
  list(projectId: string, filter: CheckoutsFilter): Checkout[];
  /** How many rows the filter matches, ignoring the page. */
  total(projectId: string, filter: CheckoutsFilter): number;
  setStash(id: string, stashStateId: string): void;
  /** The job id lands after `enqueue`; the row itself exists before it (09 §9.2). */
  setJob(id: string, jobId: string): void;
  setAdapterResult(id: string, adapterId: string, outcome: AdapterOutcome): void;
  resetAdapters(id: string, adapterIds: string[], jobId: string): void;
  finish(id: string, status: Checkout["status"], at: string): void;
  counters(id: string): AdapterCounters[];
};

const counterSchema = v.object({
  name: v.string(),
  ok: v.boolean(),
  error: v.optional(v.string()),
});

export function createCheckoutsRepository(db: MetadataDb): CheckoutsRepository {
  const adaptersOf = (ids: string[]): Map<string, v.InferOutput<typeof adapterRow>[]> => {
    const byCheckout = new Map<string, v.InferOutput<typeof adapterRow>[]>();
    if (ids.length === 0) return byCheckout;
    const marks = ids.map(() => "?").join(", ");
    const rows = v.parse(
      v.array(adapterRow),
      db.query(`${ADAPTERS} WHERE ca.checkout_id IN (${marks}) ORDER BY name`).all(...ids)
    );
    for (const row of rows) {
      byCheckout.set(row.checkout_id, [...(byCheckout.get(row.checkout_id) ?? []), row]);
    }
    return byCheckout;
  };
  return {
    insert(checkout) {
      db.transaction(() => {
        db.query(
          `INSERT INTO checkouts (id, project_id, state_id, job_id, stash_state_id, force, purpose, status,
             actor_user_id, actor_token_id, created_at, finished_at)
           VALUES (?, ?, ?, ?, NULL, ?, ?, 'running', ?, ?, ?, NULL)`
        ).run(
          checkout.id,
          checkout.project_id,
          checkout.state_id,
          checkout.job_id,
          checkout.force ? 1 : 0,
          checkout.purpose,
          checkout.actor.kind === "user" ? checkout.actor.id : null,
          checkout.actor.kind === "token" ? checkout.actor.id : null,
          checkout.created_at
        );
        for (const adapterId of checkout.adapter_ids) {
          db.query("INSERT INTO checkout_adapters (checkout_id, adapter_id) VALUES (?, ?)").run(
            checkout.id,
            adapterId
          );
        }
      })();
    },
    byId(projectId, id) {
      const row = db.query(`${SELECT} WHERE c.project_id = ? AND c.id = ?`).get(projectId, id);
      if (row === null) return null;
      const parsed = v.parse(checkoutRow, row);
      return toCheckout(parsed, adaptersOf([parsed.id]).get(parsed.id) ?? []);
    },
    byJobId(projectId, jobId) {
      const row = db
        .query(`${SELECT} WHERE c.project_id = ? AND c.job_id = ? LIMIT 1`)
        .get(projectId, jobId);
      if (row === null) return null;
      const parsed = v.parse(checkoutRow, row);
      return toCheckout(parsed, adaptersOf([parsed.id]).get(parsed.id) ?? []);
    },
    total(projectId, filter) {
      // The same conditions as `list` without the cursor: counting from the cursor would answer
      // "how many are left", not "how many match". The joins stay, because `q` searches them.
      const { where, params } = conditions(projectId, filter);
      const row = db
        .query(`SELECT COUNT(*) AS n ${FROM} WHERE ${where.join(" AND ")}`)
        .get(...params);
      return v.parse(v.object({ n: v.number() }), row).n;
    },
    list(projectId, filter) {
      const { where, params } = conditions(projectId, filter);
      const column = SORT_COLUMNS[filter.sort];
      const direction = filter.order === "desc" ? "DESC" : "ASC";
      const after = keysetCondition(
        { column, id: "c.id", sort: filter.sort, order: filter.order, idOrder: "asc" },
        filter.cursor
      );
      if (after !== null) {
        where.push(after.sql);
        params.push(...after.params);
      }
      const rows = v.parse(
        v.array(checkoutRow),
        db
          .query(
            `${SELECT} WHERE ${where.join(" AND ")} ORDER BY ${column} ${direction}, c.id ASC LIMIT ?`
          )
          .all(...params, filter.limit)
      );
      const adapters = adaptersOf(rows.map((row) => row.id));
      return rows.map((row) => toCheckout(row, adapters.get(row.id) ?? []));
    },
    setJob(id, jobId) {
      db.query("UPDATE checkouts SET job_id = ? WHERE id = ?").run(jobId, id);
    },
    setStash(id, stashStateId) {
      db.query("UPDATE checkouts SET stash_state_id = ? WHERE id = ?").run(stashStateId, id);
    },
    setAdapterResult(id, adapterId, outcome) {
      db.query(
        `UPDATE checkout_adapters SET result = ?, strategy = ?, rows = ?, duration_ms = ?, lock_wait_ms = ?,
           skipped_tables = ?, skipped_columns = ?, defaulted_columns = ?, counters = ?, error = ?
         WHERE checkout_id = ? AND adapter_id = ?`
      ).run(
        outcome.result,
        outcome.strategy === null ? null : JSON.stringify(outcome.strategy),
        outcome.rows,
        outcome.duration_ms,
        outcome.lock_wait_ms,
        JSON.stringify(outcome.skipped_tables),
        JSON.stringify(outcome.skipped_columns),
        JSON.stringify(outcome.defaulted_columns),
        JSON.stringify(outcome.counters),
        outcome.error === null ? null : JSON.stringify(outcome.error),
        id,
        adapterId
      );
    },
    resetAdapters(id, adapterIds, jobId) {
      db.transaction(() => {
        db.query(
          "UPDATE checkouts SET job_id = ?, status = 'running', finished_at = NULL WHERE id = ?"
        ).run(jobId, id);
        for (const adapterId of adapterIds) {
          db.query(
            "UPDATE checkout_adapters SET result = 'pending', error = NULL WHERE checkout_id = ? AND adapter_id = ?"
          ).run(id, adapterId);
        }
      })();
    },
    finish(id, status, at) {
      db.query("UPDATE checkouts SET status = ?, finished_at = ? WHERE id = ?").run(status, at, id);
    },
    counters(id) {
      const rows = v.parse(
        v.array(v.object({ adapter_id: v.string(), counters: v.string() })),
        db
          .query(
            "SELECT adapter_id, counters FROM checkout_adapters WHERE checkout_id = ? ORDER BY adapter_id"
          )
          .all(id)
      );
      return rows.map((row) => ({
        adapter_id: row.adapter_id,
        counters: v.parse(v.array(counterSchema), JSON.parse(row.counters)).map((counter) => {
          const result: CounterResult = { name: counter.name, ok: counter.ok };
          if (counter.error !== undefined) result.error = counter.error;
          return result;
        }),
      }));
    },
  };
}

import type { TableRef, TableSchema } from "@testate/shared";

import { EngineError, tableKey } from "../types.ts";

export type DependencyPlan = {
  /** Insert order: referenced tables before referencing tables. */
  order: TableRef[];
  /** The plan's tables plus every table that references them transitively (13 §13.4 step 3). */
  truncateSet: TableRef[];
  /** Tables outside the plan that reference plan tables; they must be empty or the restore refuses. */
  outsideReferencers: TableRef[];
  /** Tables with a nullable self-reference; restored in two phases. */
  selfReferencing: TableRef[];
};

/**
 * Database-wide FK closure and a topological insert order over the requested tables.
 * Throws `batch_failed` on a cycle between distinct tables (ADR 0001).
 */
export function computeDependencyOrder(
  tables: TableSchema[],
  requested: TableRef[]
): DependencyPlan {
  const byName = new Map(tables.map((table) => [tableKey(table), table]));
  const wanted = new Set(requested.map(tableKey));
  const closure = new Set(wanted);
  const queue = [...wanted];
  while (queue.length > 0) {
    const key = queue.pop();
    if (key === undefined) break;
    for (const fk of byName.get(key)?.foreign_keys_in ?? []) {
      const from = tableKey(fk.from);
      if (!closure.has(from)) {
        closure.add(from);
        queue.push(from);
      }
    }
  }
  const outside = [...closure].filter((key) => !wanted.has(key));
  const order = topological([...wanted], byName);
  const refOf = (key: string): TableRef => {
    const table = byName.get(key);
    return table === undefined
      ? { schema: null, name: key }
      : { schema: table.schema, name: table.name };
  };
  return {
    order: order.map(refOf),
    truncateSet: [...closure].map(refOf),
    outsideReferencers: outside.map(refOf),
    selfReferencing: [...wanted]
      .filter(
        (key) => byName.get(key)?.foreign_keys_out.some((fk) => tableKey(fk.ref) === key) === true
      )
      .map(refOf),
  };
}

function readyKeys(remaining: Map<string, Set<string>>): string[] {
  return [...remaining.entries()]
    .filter(([, deps]) => deps.size === 0)
    .map(([key]) => key)
    .sort();
}

/** Kahn's algorithm over the FK edges among the requested tables; self-references are ignored here. */
function dependencies(keys: string[], byName: Map<string, TableSchema>): Map<string, Set<string>> {
  const inSet = new Set(keys);
  const remaining = new Map<string, Set<string>>();
  for (const key of keys) {
    const deps = new Set<string>();
    for (const fk of byName.get(key)?.foreign_keys_out ?? []) {
      const target = tableKey(fk.ref);
      if (target !== key && inSet.has(target)) deps.add(target);
    }
    remaining.set(key, deps);
  }
  return remaining;
}

function topological(keys: string[], byName: Map<string, TableSchema>): string[] {
  const remaining = dependencies(keys, byName);
  const order: string[] = [];
  while (remaining.size > 0) {
    const ready = readyKeys(remaining);
    if (ready.length === 0) {
      throw new EngineError("batch_failed", "foreign keys form a cycle between tables", {
        tables: [...remaining.keys()],
      });
    }
    for (const key of ready) {
      order.push(key);
      remaining.delete(key);
      for (const deps of remaining.values()) deps.delete(key);
    }
  }
  return order;
}

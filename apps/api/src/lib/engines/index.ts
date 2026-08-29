import type { Engine } from "@testate/shared";

import type { Netguard } from "./postgres/pool.ts";
import { createMysqlEngine } from "./mysql/engine.ts";
import { createPostgresEngine } from "./postgres/engine.ts";
import { EngineError } from "./types.ts";
import type { DbEngine } from "./types.ts";

export type { Netguard } from "./postgres/pool.ts";
export * from "./types.ts";
export { computeFingerprint } from "./pure/fingerprint.ts";
export { diffSchema, forceIntersection } from "./pure/diff-schema.ts";
export { computeDependencyOrder } from "./pure/dependency-order.ts";
export { selectRestoreStrategy } from "./pure/strategy.ts";

export type EngineRegistry = {
  /** The engine for a database adapter's engine name; null when this build has none for it. */
  get(engine: Engine): DbEngine | null;
  require(engine: Engine): DbEngine;
};

/** SCAFFOLD: the mongodb card registers its engine here (12 §12.9). */
export function createEngineRegistry(netguard: Netguard): EngineRegistry {
  const mysql = createMysqlEngine(netguard);
  const engines = new Map<Engine, DbEngine>([
    ["postgres", createPostgresEngine(netguard)],
    ["mysql", mysql],
    ["mariadb", mysql],
  ]);
  return {
    get: (engine) => engines.get(engine) ?? null,
    require(engine) {
      const found = engines.get(engine);
      if (found === undefined)
        throw new EngineError("unsupported", `${engine} has no engine in this build`);
      return found;
    },
  };
}

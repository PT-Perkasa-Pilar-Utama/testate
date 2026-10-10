import type { AdapterDraft } from "@testate/shared";

import { createFakeEngine } from "../src/lib/engines/fake/engine.ts";
import type { FakeDatabase, FakeEngineOptions } from "../src/lib/engines/fake/engine.ts";
import type { DbEngine, EngineRegistry } from "../src/lib/engines/index.ts";

/** The drafts and the fake engine the adapters harness builds on. */
export const PG: AdapterDraft = {
  kind: "database",
  engine: "postgres",
  name: "orders-db",
  mode: "sandbox",
  config: { host: "pg.sit.internal", port: 5432, database: "shop", user: "testate" },
  secrets: { password: "pg-secret" },
};

export const S3: AdapterDraft = {
  kind: "storage",
  engine: "s3",
  name: "exports",
  mode: "sandbox",
  config: {
    bucket: "exports",
    region: "ap-southeast-1",
    endpoint: "https://minio.sit.internal:9000",
  },
  secrets: { access_key_id: "AKIA", secret_access_key: "s3-secret" },
};

export function fakeRegistry(opts: FakeEngineOptions): EngineRegistry {
  const engine: DbEngine = createFakeEngine(opts);
  return {
    get: (name) => (name === "postgres" ? engine : null),
    require(name) {
      if (name !== "postgres") throw new Error(`${name} has no engine in the test registry`);
      return engine;
    },
  };
}

export function shopDatabase(): FakeDatabase {
  return new Map([
    [
      "public.customers",
      [
        { id: 1, email: "a@x.io" },
        { id: 2, email: "b@x.io" },
      ],
    ],
    ["public.orders", [{ id: 1, customer_id: 1, total: "10.00" }]],
  ]);
}

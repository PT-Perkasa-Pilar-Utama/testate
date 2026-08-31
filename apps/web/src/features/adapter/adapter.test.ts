import { describe, expect, test } from "bun:test";
import type { Adapter } from "@testate/shared";

import { draftFrom, toPatchBody } from "./adapter.edit.ts";

const ADAPTER: Adapter = {
  id: "a1",
  project_id: "p1",
  kind: "database",
  engine: "postgres",
  tier: "tabular",
  name: "shop",
  mode: "sandbox",
  status: "ok",
  status_message: null,
  config: { host: "127.0.0.1", port: 15432, database: "shop", user: "testate" },
  credential: { set: true, key_fingerprint: "ab", set_at: "2026-08-29T00:00:00.000Z" },
  readonly_credential: { set: false },
  excluded_tables: ["contract.schema_migrations"],
  restore_mode: "atomic",
  lock_timeout_ms: 60000,
  engine_version: null,
  dialect: null,
  capabilities: null,
  strategy: null,
  read_only_enforcement: null,
  last_probe_at: null,
  created_at: "2026-08-29T00:00:00.000Z",
  updated_at: "2026-08-29T00:00:00.000Z",
};

describe("adapter editing", () => {
  test("an unchanged draft sends nothing; edits send only their keys (stories 24, 29)", () => {
    const draft = draftFrom(ADAPTER);
    expect(toPatchBody(draft, ADAPTER)).toStrictEqual({});
    expect(
      toPatchBody(
        {
          ...draft,
          name: " shop-2 ",
          excluded_tables: "contract.schema_migrations, contract.notes",
        },
        ADAPTER
      )
    ).toStrictEqual({
      name: "shop-2",
      excluded_tables: ["contract.schema_migrations", "contract.notes"],
    });
  });

  test("a connection or schema change carries the whole config; secrets go only when typed (23, 26, 28)", () => {
    const draft = draftFrom(ADAPTER);
    expect(
      toPatchBody(
        { ...draft, schemas: "contract", values: { ...draft.values, "readonly.password": "ro" } },
        ADAPTER
      )
    ).toStrictEqual({
      config: {
        host: "127.0.0.1",
        port: 15432,
        database: "shop",
        user: "testate",
        schemas: ["contract"],
      },
      readonly_secrets: { password: "ro" },
    });
    expect(
      toPatchBody({ ...draft, values: { ...draft.values, "config.host": "db2" } }, ADAPTER)[
        "config"
      ]
    ).toStrictEqual({ host: "db2", port: 15432, database: "shop", user: "testate" });
  });
});

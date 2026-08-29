import { expect, test } from "@playwright/test";

import { bootApi, bootDir, bootEnv, newKey } from "./lib/boot.ts";
import type { Booted } from "./lib/boot.ts";
import { adminSession, call, seedProject, takeStateOn, waitIdle } from "./lib/instance.ts";
import type { AdminSession } from "./lib/instance.ts";
import { createDatabase, dropDatabase, runSql } from "./lib/sql.ts";

const STAMP = Date.now().toString(36);

test.describe.configure({ mode: "serial" });

let booted: Booted;
let session: AdminSession;

test.beforeAll(async () => {
  booted = await bootApi(bootEnv(bootDir("types"), newKey(), 3111));
  session = await adminSession(booted.base);
});

test.afterAll(async () => {
  await booted.stop();
});

/** One row per Postgres type family the snapshot has to carry unchanged (14 §14.1). */
const WIDE_TABLE = `CREATE TABLE wide (
  id bigint primary key,
  big numeric(38,10),
  huge bigint,
  binary_value bytea,
  moment timestamptz,
  document jsonb,
  labels text[],
  mood mood_kind,
  postcode postcode
)`;

const ORIGINAL = `INSERT INTO wide VALUES (
  1,
  12345678901234567890123456.1234567890,
  9223372036854775807,
  '\\xdeadbeef'::bytea,
  '2026-03-29T01:30:00+02:00'::timestamptz,
  '{"a":[1,2,{"b":null}]}'::jsonb,
  ARRAY['one','two'],
  'calm',
  '1234AB'
)`;

test("@story-72 a snapshot and checkout keep every type exactly", async () => {
  test.setTimeout(240_000);
  const database = `types_${STAMP}`;
  createDatabase(database);
  runSql(database, [
    "CREATE TYPE mood_kind AS ENUM ('calm', 'loud')",
    "CREATE DOMAIN postcode AS text CHECK (VALUE ~ '^[0-9]{4}[A-Z]{2}$')",
    WIDE_TABLE,
    ORIGINAL,
  ]);
  const before = runSql<unknown[]>(database, ["SELECT * FROM wide"]);
  const slug = `types-${STAMP}`;
  const adapterId = await seedProject(session, slug, database);
  await waitIdle(session);
  const taken = await takeStateOn(session, slug, adapterId, "wide-baseline");

  runSql(database, ["DELETE FROM wide"]);
  const checkout = await call<{ data: { job: { status: string } } }>(
    session,
    "POST",
    `projects/${slug}/checkouts?wait=120`,
    { state_id: taken.stateId }
  );
  expect(checkout.json.data.job.status).toBe("succeeded");
  const after = runSql<unknown[]>(database, ["SELECT * FROM wide"]);
  expect(after).toStrictEqual(before);
  dropDatabase(database);
});

type SchemaReply = {
  data: { tables: { name: string; unsupported: { column: string; reason: string }[] }[] };
};
type StateDetail = {
  data: { adapters: { warnings: { code: string; column?: string }[] }[] };
};

test("@story-73 an unsupported column is named at introspection and on every state", async () => {
  test.setTimeout(240_000);
  const database = `unsupported_${STAMP}`;
  createDatabase(database);
  // A large object: the column holds an oid, the bytes live in pg_largeobject.
  runSql(database, [
    "CREATE TABLE attachments (id int primary key, body oid)",
    "INSERT INTO attachments VALUES (1, lo_from_bytea(0, '\\xcafebabe'::bytea))",
  ]);
  const slug = `unsupported-${STAMP}`;
  const adapterId = await seedProject(session, slug, database);
  await waitIdle(session);

  const schema = await call<SchemaReply>(
    session,
    "GET",
    `projects/${slug}/adapters/${adapterId}/schema`
  );
  const table = schema.json.data.tables.find((entry) => entry.name === "attachments");
  expect(table?.unsupported.map((item) => item.column)).toStrictEqual(["body"]);

  const taken = await takeStateOn(session, slug, adapterId, "with-large-object");
  const detail = await call<StateDetail>(
    session,
    "GET",
    `projects/${slug}/states/${taken.stateId}`
  );
  const warnings = detail.json.data.adapters.flatMap((adapter) => adapter.warnings);
  expect(warnings.map((warning) => warning.code)).toContain("unsupported_column");
  expect(warnings.map((warning) => warning.column)).toContain("body");
  dropDatabase(database);
});

import { expect, test } from "@playwright/test";

import { bootApi, bootDir, bootEnv, newKey } from "./lib/boot.ts";
import type { Booted } from "./lib/boot.ts";
import {
  adminSession,
  call,
  draftFor,
  seedProject,
  takeStateOn,
  waitIdle,
  whileJobRuns,
} from "./lib/instance.ts";
import type { AdminSession } from "./lib/instance.ts";
import {
  awaitLock,
  countRows,
  createDatabase,
  dropDatabase,
  holdTableLock,
  runSql,
} from "./lib/sql.ts";

const STAMP = Date.now().toString(36);

// One spawned instance for the file; every test gets its own database and project.
test.describe.configure({ mode: "serial" });

let booted: Booted;
let session: AdminSession;

test.beforeAll(async () => {
  booted = await bootApi(bootEnv(bootDir("engine"), newKey(), 3110));
  session = await adminSession(booted.base);
});

test.afterAll(async () => {
  await booted.stop();
});

type CheckoutDetail = {
  data: {
    status: string;
    adapters: {
      result: string;
      error: { code: string; details: { blocking_sessions?: unknown[] } } | null;
      skipped_tables: unknown[];
      skipped_columns: unknown[];
      defaulted_columns: unknown[];
    }[];
  };
};

type StateDetail = {
  data: { adapters: { tables: { schema: string | null; name: string; rows: number }[] }[] };
};

function rowsOf(detail: StateDetail, table: string): number {
  const found = detail.data.adapters
    .flatMap((adapter) => adapter.tables)
    .find((entry) => entry.name === table);
  if (found === undefined) throw new Error(`the manifest has no table ${table}`);
  return found.rows;
}

test("@story-63 one snapshot reads every table at the same point in time", async () => {
  test.setTimeout(240_000);
  const database = `pit_${STAMP}`;
  createDatabase(database);
  // `big` takes seconds to stream, so the write below lands while the snapshot is still running.
  runSql(database, [
    "CREATE TABLE big (id bigint primary key, pad text)",
    "INSERT INTO big SELECT g, repeat('x', 200) FROM generate_series(1, 300000) g",
    "CREATE TABLE small (id int primary key)",
    "INSERT INTO small VALUES (1)",
  ]);
  const adapterId = await seedProject(session, `pit-${STAMP}`, database);
  await waitIdle(session);

  const started = await call<{ data: { state: { id: string }; job: { id: string } } }>(
    session,
    "POST",
    `projects/pit-${STAMP}/states`,
    { name: "point-in-time", adapter_ids: [adapterId] }
  );
  expect(started.status).toBe(202);
  // The insert has to land mid-snapshot, or the assertion below proves nothing.
  const timing = await whileJobRuns(session, started.json.data.job.id, () => {
    runSql(database, ["INSERT INTO small VALUES (2)"]);
  });
  expect(timing).toBe("ran while the job was running");

  await waitIdle(session);
  const detail = await call<StateDetail>(
    session,
    "GET",
    `projects/pit-${STAMP}/states/${started.json.data.state.id}`
  );
  expect(rowsOf(detail.json, "big")).toBe(300_000);
  expect(rowsOf(detail.json, "small")).toBe(1);
  expect(countRows(database, "small")).toBe(2);
  dropDatabase(database);
});

test("@story-78 a forced checkout restores what both sides share and reports the rest", async () => {
  test.setTimeout(240_000);
  const database = `force_${STAMP}`;
  createDatabase(database);
  runSql(database, [
    "CREATE TABLE kept (id int primary key, label text)",
    "INSERT INTO kept VALUES (1, 'before')",
  ]);
  const slug = `force-${STAMP}`;
  const adapterId = await seedProject(session, slug, database);
  await waitIdle(session);
  const taken = await takeStateOn(session, slug, adapterId, "before-drift");

  // Drift: a column and a table the state never saw.
  runSql(database, [
    "UPDATE kept SET label = 'after'",
    "ALTER TABLE kept ADD COLUMN extra text NOT NULL DEFAULT 'x'",
    "CREATE TABLE added (id int primary key)",
  ]);

  // Without force the job refuses: the restore rolls back and the adapter names the drift.
  const refused = await call<{ data: { checkout: { id: string } } }>(
    session,
    "POST",
    `projects/${slug}/checkouts?wait=120`,
    { state_id: taken.stateId }
  );
  const rolled = await call<CheckoutDetail>(
    session,
    "GET",
    `projects/${slug}/checkouts/${refused.json.data.checkout.id}`
  );
  expect(rolled.json.data.status).toBe("failed");
  expect(rolled.json.data.adapters[0]?.error?.code).toBe("SCHEMA_DRIFT");
  expect(runSql<{ label: string }[]>(database, ["SELECT label FROM kept"])[0]?.label).toBe("after");

  const forced = await call<{ data: { job: { id: string }; checkout: { id: string } } }>(
    session,
    "POST",
    `projects/${slug}/checkouts?wait=120`,
    { state_id: taken.stateId, force: true }
  );
  expect(forced.status).toBe(200);
  const checkout = await call<CheckoutDetail>(
    session,
    "GET",
    `projects/${slug}/checkouts/${forced.json.data.checkout.id}`
  );
  expect(checkout.json.data.status).toBe("succeeded");
  // The shared column came back; the column the state never had kept its default.
  expect(runSql<{ label: string }[]>(database, ["SELECT label FROM kept"])[0]?.label).toBe(
    "before"
  );
  expect(checkout.json.data.adapters[0]?.defaulted_columns.length).toBeGreaterThan(0);
  dropDatabase(database);
});

test("@story-83 a failed restore leaves the database as it found it", async () => {
  test.setTimeout(240_000);
  const database = `atomic_${STAMP}`;
  createDatabase(database);
  runSql(database, [
    "CREATE TABLE a_first (id int primary key, label text)",
    "CREATE TABLE z_last (id int primary key, label text)",
    "INSERT INTO a_first VALUES (1, 'before')",
    "INSERT INTO z_last VALUES (1, 'before')",
  ]);
  const slug = `atomic-${STAMP}`;
  const adapterId = await seedProject(session, slug, database);
  await waitIdle(session);
  const taken = await takeStateOn(session, slug, adapterId, "atomic-baseline");

  // A check the stored rows cannot satisfy: the restore fails on the second table, not the first.
  // (A trigger would not do: the restore runs with triggers off, as an application restore should.)
  runSql(database, [
    "UPDATE a_first SET label = 'after'",
    "UPDATE z_last SET label = 'after'",
    "ALTER TABLE z_last ADD CONSTRAINT never_before CHECK (label <> 'before')",
  ]);
  const attempt = await call<{ data: { checkout: { id: string } } }>(
    session,
    "POST",
    `projects/${slug}/checkouts?wait=120`,
    { state_id: taken.stateId }
  );
  const checkout = await call<CheckoutDetail>(
    session,
    "GET",
    `projects/${slug}/checkouts/${attempt.json.data.checkout.id}`
  );
  expect(checkout.json.data.status).toBe("failed");
  expect(checkout.json.data.adapters[0]?.result).toBe("rolled_back");
  // One transaction: the first table's restore rolled back with the second table's failure.
  expect(runSql<{ label: string }[]>(database, ["SELECT label FROM a_first"])[0]?.label).toBe(
    "after"
  );
  dropDatabase(database);
});

test("@story-85 a checkout that waits on a lock times out and names the session holding it", async () => {
  test.setTimeout(240_000);
  const database = `locked_${STAMP}`;
  createDatabase(database);
  runSql(database, ["CREATE TABLE held (id int primary key)", "INSERT INTO held VALUES (1)"]);
  const slug = `locked-${STAMP}`;
  await call(session, "PATCH", "settings", { netguard: { deny: [] } });
  await call(session, "POST", "projects", { slug, name: slug });
  const created = await call<{ data: { adapter: { id: string } } }>(
    session,
    "POST",
    `projects/${slug}/adapters`,
    { ...draftFor("127.0.0.1", "held", database), lock_timeout_ms: 2000 }
  );
  expect(created.status).toBe(201);
  await waitIdle(session);
  const taken = await takeStateOn(session, slug, created.json.data.adapter.id, "locked-baseline");

  const holder = holdTableLock(database, "held", 30);
  await awaitLock(database, "held");
  const attempt = await call<{ data: { checkout: { id: string } } }>(
    session,
    "POST",
    `projects/${slug}/checkouts?wait=120`,
    { state_id: taken.stateId }
  );
  const checkout = await call<CheckoutDetail>(
    session,
    "GET",
    `projects/${slug}/checkouts/${attempt.json.data.checkout.id}`
  );
  holder.release();
  expect(checkout.json.data.status).toBe("failed");
  expect(checkout.json.data.adapters[0]?.error?.code).toBe("CHECKOUT_BLOCKED");
  expect(checkout.json.data.adapters[0]?.error?.details.blocking_sessions?.length).toBeGreaterThan(
    0
  );
  dropDatabase(database);
});

test("@story-15 a project whose planned restore fails stays in place, with HEAD unknown", async () => {
  test.setTimeout(240_000);
  const database = `deletion_${STAMP}`;
  createDatabase(database);
  runSql(database, [
    "CREATE TABLE t (id int primary key, label text)",
    "INSERT INTO t VALUES (1, 'before')",
  ]);
  const slug = `deletion-${STAMP}`;
  const adapterId = await seedProject(session, slug, database);
  await waitIdle(session);

  // The init state can no longer be restored: the live table refuses the rows it holds.
  runSql(database, [
    "UPDATE t SET label = 'after'",
    "ALTER TABLE t ADD CONSTRAINT never_before CHECK (label <> 'before')",
  ]);
  const plan = await call<{ data: { plan_id: string } }>(
    session,
    "GET",
    `projects/${slug}/deletion-plan`
  );
  const removal = await call<{ data: { id: string; status: string } }>(
    session,
    "POST",
    `projects/${slug}/deletion?wait=120`,
    {
      confirm_slug: slug,
      plan_id: plan.json.data.plan_id,
      adapters: [{ adapter_id: adapterId, action: "restore" }],
    }
  );
  expect(removal.json.data.status).toBe("failed");

  const project = await call<{
    data: {
      project: { head: { status: string } };
      adapters: { id: string }[];
      banner: { kind: string } | null;
    };
  }>(session, "GET", `projects/${slug}`);
  expect(project.status).toBe(200);
  expect(project.json.data.project.head.status).toBe("unknown");
  expect(project.json.data.banner?.kind).toBe("head_unknown");
  expect(project.json.data.adapters.map((adapter) => adapter.id)).toContain(adapterId);
  expect(runSql<{ label: string }[]>(database, ["SELECT label FROM t"])[0]?.label).toBe("after");
  dropDatabase(database);
});

test("@story-20 an engine below the floor is refused, and the message names the floor", async () => {
  test.setTimeout(180_000);
  const slug = `floor-${STAMP}`;
  await call(session, "PATCH", "settings", { netguard: { deny: [] } });
  await call(session, "POST", "projects", { slug, name: slug });
  const draft = draftFor("127.0.0.1", "old-postgres");
  const attempt = await call<{
    error: { code: string; message: string; details: { floor: string } };
  }>(session, "POST", `projects/${slug}/adapters/test`, {
    ...draft,
    config: { ...draft.config, port: 15433 },
  });
  expect(attempt.status).toBe(422);
  expect(attempt.json.error.code).toBe("ENGINE_UNSUPPORTED");
  expect(attempt.json.error.details.floor).toBe("13");
  expect(attempt.json.error.message).toContain("below the floor");
});

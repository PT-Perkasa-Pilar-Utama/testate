/**
 * What a visitor finds on arrival (#demo): three accounts, a Shop project with a database, a file
 * store and an app's logs, two states, a diff, a checkout and a reading. Everything goes through
 * the services, the same calls a person's clicks make, except the monitor's day of history,
 * which no click could write.
 */
import type { Actor, AdapterDraft } from "@testate/shared";

import type { FakeDatabase } from "../../../api/src/lib/engines/fake/engine.ts";
import type { RequestMeta } from "../../../api/src/lib/http/auth.ts";
import { ADMIN } from "./boot.ts";
import type { DemoBackend } from "./boot.ts";
import { history } from "./host-clock.ts";
import { APP_HOST, DB_HOST, FILES_HOST } from "./world.ts";

export const ACCOUNTS = [
  { username: "tina", display_name: "Tina (tester)", role: "qa", password: "tina-demo-1234" },
  { username: "vera", display_name: "Vera (viewer)", role: "viewer", password: "vera-demo-1234" },
] as const;

const META: RequestMeta = { ip: "", user_agent: "demo", request_id: null };
const WAIT_SECONDS = 30;

const DRAFTS: AdapterDraft[] = [
  {
    kind: "database",
    engine: "postgres",
    name: "orders-db",
    mode: "sandbox",
    config: { host: DB_HOST, port: 5432, database: "shop", user: "shop" },
    secrets: { password: "demo-database" },
  },
  {
    kind: "storage",
    engine: "sftp",
    name: "uploads",
    mode: "sandbox",
    config: { host: FILES_HOST, user: "deploy", root_path: "/srv/uploads" },
    secrets: { password: "demo-files" },
  },
  {
    kind: "logs",
    engine: "logfile",
    name: "shop-api-logs",
    config: {
      transport: "sftp",
      host: APP_HOST,
      user: "deploy",
      root_path: "/home/deploy",
      sources: [{ name: "api", glob: ".pm2/logs/shop-api-*.log", format: "pm2" }],
    },
    secrets: { password: "demo-app" },
  },
];

/** A test run's footprint on the shop: a refund, a new order, a price change. */
function dirty(shop: FakeDatabase): void {
  const orders = shop.get("public.orders") ?? [];
  const twelve = orders.find((row) => row["id"] === 12);
  if (twelve !== undefined) twelve["status"] = "refunded";
  orders.push({ id: 19, customer_id: 3, product_id: 5, quantity: 1, status: "paid" });
  const kettle = (shop.get("public.products") ?? []).find((row) => row["id"] === 2);
  if (kettle !== undefined) kettle["price"] = "399000.00";
}

export async function seedDemo(backend: DemoBackend, shop: FakeDatabase): Promise<void> {
  const { services, usersRepo } = backend;
  const record = usersRepo.byUsername(ADMIN.username);
  if (record === null) throw new Error("the demo's admin is missing");
  const now = new Date().toISOString();
  // The demo's accounts start signed in or one form away: no forced change on a first sign-in.
  usersRepo.setPassword(record.id, await backend.hash(ADMIN.password), false, now);
  const admin: Actor = {
    kind: "user",
    id: record.id,
    label: record.username,
    role: "admin",
    agent: false,
  };
  for (const account of ACCOUNTS) {
    const user = await services.users.create(
      admin,
      { ...account, temporary_password: account.password, project_ids: null },
      META
    );
    usersRepo.setPassword(user.id, await backend.hash(account.password), false, now);
  }
  const project = await services.projects.create(
    admin,
    {
      slug: "shop",
      name: "Shop",
      description: "The demo's shop: an orders database, a file store and the API's logs.",
    },
    META
  );
  for (const draft of DRAFTS) {
    const { init_job } = await services.adapters.create(admin, project.slug, draft, META);
    if (init_job !== null) await services.jobs.wait(null, init_job.id, WAIT_SECONDS);
  }
  const baseline = await services.states.snapshot(
    admin,
    project.slug,
    { name: "seeded-baseline", notes: "The shop before any test touched it.", tags: ["baseline"] },
    META
  );
  await services.jobs.wait(null, baseline.job.id, WAIT_SECONDS);
  dirty(shop);
  const after = await services.states.snapshot(
    admin,
    project.slug,
    { name: "after-refund-test", notes: "What the refund test left behind.", tags: ["run"] },
    META
  );
  await services.jobs.wait(null, after.job.id, WAIT_SECONDS);
  const diff = await services.diffs.create(
    admin,
    project.slug,
    baseline.state.id,
    { state_id: after.state.id },
    undefined,
    META
  );
  await services.jobs.wait(null, diff.job.id, WAIT_SECONDS);
  const checkout = await services.checkouts.create(
    admin,
    project.slug,
    { state_id: baseline.state.id, force: false },
    META
  );
  await services.jobs.wait(null, checkout.job.id, WAIT_SECONDS);
  const { reading } = await services.readings.take(admin, project.slug);
  // The day before the visit, from the same curve the live files follow (#101).
  const adapters = reading.adapters.map(({ values: _values, unavailable: _gaps, ...adapter }) => ({
    ...adapter,
    scale: adapter.name === "uploads" ? 0.4 : 1,
    app: adapter.name === "shop-api-logs",
  }));
  for (const row of history(project.id, adapters, Date.now())) backend.readingsRepo.insert(row);
}

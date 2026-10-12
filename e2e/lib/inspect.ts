import type { APIRequestContext } from "@playwright/test";

import { waitForJob } from "./api.ts";

/** The compose Postgres the seed's `shop-postgres` reads, as an adapter draft's config. */
export const SHOP_POSTGRES = {
  host: "127.0.0.1",
  port: 15432,
  database: "shop",
  user: "testate",
  password: "testate",
};

export type ProjectRef = { id: string; slug: string };

/** The built-in Inspect project, found by kind: its slug is `inspect` only when that was free. */
export async function inspectProject(context: APIRequestContext): Promise<ProjectRef> {
  const body: { data: ProjectRef[] } = await (await context.get("projects?kind=inspect")).json();
  const [inspect] = body.data;
  if (inspect === undefined) throw new Error("the Inspect project is missing");
  return inspect;
}

export type AdapterRef = { id: string; name: string; mode: string };

/** One adapter of a project by name; a missing one means the step that made it failed. */
export async function adapterNamed(
  context: APIRequestContext,
  slug: string,
  name: string
): Promise<AdapterRef> {
  const body: { data: AdapterRef[] } = await (
    await context.get(`projects/${slug}/adapters`)
  ).json();
  const found = body.data.find((adapter) => adapter.name === name);
  if (found === undefined) throw new Error(`${name} is not in ${slug}`);
  return found;
}

/** The names of a project's adapters, to see one leave it. */
export async function adapterNames(context: APIRequestContext, slug: string): Promise<string[]> {
  const body: { data: AdapterRef[] } = await (
    await context.get(`projects/${slug}/adapters`)
  ).json();
  return body.data.map((adapter) => adapter.name);
}

/** A regular project with one Postgres adapter, its init snapshot finished. */
export async function projectWithDatabase(
  qa: APIRequestContext,
  slug: string,
  adapterName: string
): Promise<AdapterRef> {
  const project = await qa.post("projects", { data: { slug, name: slug } });
  if (project.status() !== 201)
    throw new Error(`project ${slug}: ${project.status()} ${await project.text()}`);
  const { password, ...config } = SHOP_POSTGRES;
  const created = await qa.post(`projects/${slug}/adapters`, {
    data: {
      kind: "database",
      engine: "postgres",
      name: adapterName,
      mode: "sandbox",
      config,
      secrets: { password },
    },
  });
  if (created.status() !== 201)
    throw new Error(`adapter ${adapterName}: ${created.status()} ${await created.text()}`);
  const body: { data: { adapter: AdapterRef; init_job: { id: string } | null } } =
    await created.json();
  if (body.data.init_job !== null) await waitForJob(qa, body.data.init_job.id);
  return body.data.adapter;
}

/** Removes an adapter through its own deletion plan, restoring nothing; the job's status returns. */
export async function removeAdapter(
  context: APIRequestContext,
  slug: string,
  id: string
): Promise<string> {
  const plan: { data: { plan_id: string } } = await (
    await context.get(`projects/${slug}/adapters/${id}/deletion-plan`)
  ).json();
  const removed = await context.post(`projects/${slug}/adapters/${id}/deletion`, {
    data: { plan_id: plan.data.plan_id, action: "skip" },
  });
  // 200 when the job had already finished by the time the answer was written, 202 while it runs.
  if (![200, 202].includes(removed.status()))
    throw new Error(`delete ${id}: ${removed.status()} ${await removed.text()}`);
  const body: { data: { id: string } } = await removed.json();
  return (await waitForJob(context, body.data.id)).status;
}

export type TokenRow = {
  id: string;
  name: string;
  kind: string;
  role: string;
  project_ids: string[] | null;
};

/** An API token by name, as the admin's token list shows it. */
export async function tokenNamed(admin: APIRequestContext, name: string): Promise<TokenRow> {
  const body: { data: TokenRow[] } = await (await admin.get("tokens?limit=200")).json();
  const found = body.data.find((token) => token.name === name);
  if (found === undefined) throw new Error(`no token named ${name}`);
  return found;
}

export type PolicyRow = { table: string; column: string; mask: string | null };

/** `table.column mask` for every column policy an adapter has. */
export async function policiesOf(
  context: APIRequestContext,
  slug: string,
  id: string
): Promise<string[]> {
  const body: { data: PolicyRow[] } = await (
    await context.get(`projects/${slug}/adapters/${id}/policies`)
  ).json();
  return body.data.map((policy) => `${policy.table}.${policy.column} ${policy.mask ?? "none"}`);
}

/** The names of an adapter's saved queries. */
export async function savedQueryNames(
  context: APIRequestContext,
  slug: string,
  id: string
): Promise<string[]> {
  const body: { data: { name: string }[] } = await (
    await context.get(`projects/${slug}/adapters/${id}/saved-queries`)
  ).json();
  return body.data.map((query) => query.name);
}

/** The error code a refused request answers with. */
export async function codeOf(response: {
  json: () => Promise<{ error?: { code: string } }>;
}): Promise<string> {
  const body = await response.json();
  return body.error?.code ?? "none";
}

import type { JsonObject, RestRequest, RestRun } from "@testate/shared";
import * as v from "valibot";

import { AppError, conflict, notFound } from "../../lib/http/index.ts";
import type { Check, Verdict } from "../../lib/netguard/index.ts";
import { open, seal } from "../../lib/sealed/index.ts";
import type { KeyRing, Sealed } from "../../lib/sealed/index.ts";
import { aadFor } from "../../lib/sealed/registry.ts";
import type { AdapterRecord, AdaptersRepository } from "../adapters/adapters.repository.ts";
import { CONFIG_COLUMN, openSecrets } from "../adapters/adapters.secrets.ts";
import type { ProjectsRepository } from "../projects/projects.repository.ts";
import { DEFAULT_BODY_CAP, sendRequest } from "./rest.client.ts";
import type { OutboundResponse } from "./rest.client.ts";
import { checkPlaceholders, expand, expandEntries } from "./rest.placeholders.ts";
import type { Placeholders } from "./rest.placeholders.ts";
import type { RestRepository, RestRequestPatch, RunSummary } from "./rest.repository.ts";

export { checkPlaceholders } from "./rest.placeholders.ts";

export type RestRequestInput = {
  name: string;
  method: RestRequest["method"];
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  /** Secret header values; `"keep"` on update leaves the stored value in place (12 §12.1). */
  secrets: Record<string, string>;
  body: string | null;
  expected_status: number | null;
};

export type RunContext = {
  placeholders: Omit<Placeholders, "project">;
  jobId?: string;
  hookRunId?: string;
};

export type RestService = {
  list(slug: string, adapterId: string): Promise<RestRequest[]>;
  create(slug: string, adapterId: string, input: RestRequestInput): Promise<RestRequest>;
  get(slug: string, adapterId: string, id: string): Promise<RestRequest>;
  update(
    slug: string,
    adapterId: string,
    id: string,
    input: Partial<RestRequestInput>
  ): Promise<RestRequest>;
  remove(slug: string, adapterId: string, id: string): Promise<void>;
  run(slug: string, adapterId: string, id: string, ctx: RunContext): Promise<RestRun>;
  runs(slug: string, adapterId: string, id: string, limit: number): Promise<RunSummary[]>;
  runDetail(slug: string, adapterId: string, id: string, runId: string): Promise<RestRun>;
};

export type RestDeps = {
  repo: RestRepository;
  adapters: Pick<AdaptersRepository, "byId">;
  projects: Pick<ProjectsRepository, "bySlug">;
  ring: KeyRing;
  netguard: { check(input: Check): Promise<Verdict> };
  now: () => Date;
  bodyCapBytes?: number;
};

const HEADERS_COLUMN = "headers_sealed";
const secretsSchema = v.record(v.string(), v.string());
const httpConfigSchema = v.object({
  base_url: v.string(),
  timeout_ms: v.optional(v.number(), 30000),
  verify_tls: v.optional(v.boolean(), true),
  default_headers: v.optional(v.record(v.string(), v.string()), {}),
});

function toPublic(
  record: RestRequest & { adapter_id: string; headers_sealed: Sealed | null }
): RestRequest {
  const { adapter_id: _adapter, headers_sealed: _sealed, ...request } = record;
  return request;
}

/** Placeholders are checked wherever they can appear (12 §12.1). */
function checkAll(input: Partial<RestRequestInput>): void {
  const texts: (string | null | undefined)[] = [
    input.path,
    input.body,
    ...Object.values(input.query ?? {}),
    ...Object.values(input.headers ?? {}),
  ];
  for (const text of texts) {
    if (text === undefined || text === null) continue;
    checkPlaceholders(text);
  }
}

/** Plain fields of an update; secrets are merged separately because they need the ring. */
function patchOf(input: Partial<RestRequestInput>): RestRequestPatch {
  const patch: RestRequestPatch = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.method !== undefined) patch.method = input.method;
  if (input.path !== undefined) patch.path = input.path;
  if (input.query !== undefined) patch.query = input.query;
  if (input.headers !== undefined) patch.headers = input.headers;
  if (input.body !== undefined) patch.body = input.body;
  if (input.expected_status !== undefined) patch.expected_status = input.expected_status;
  return patch;
}

/** `"keep"` takes the stored value; anything else replaces it; absent keys are dropped (12 §12.1). */
function mergeSecrets(stored: Record<string, string>, incoming: Record<string, string>) {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(incoming)) {
    const kept = value === "keep" ? stored[key] : value;
    if (kept !== undefined) merged[key] = kept;
  }
  return merged;
}

export function createRestService(deps: RestDeps): RestService {
  const { repo } = deps;
  const nowIso = (): string => deps.now().toISOString();
  const adapterOf = (slug: string, adapterId: string): AdapterRecord => {
    const project = deps.projects.bySlug(slug);
    if (project === null) throw notFound("project");
    const adapter = deps.adapters.byId(adapterId);
    if (adapter === null || adapter.project_id !== project.id) throw notFound("adapter");
    if (adapter.kind !== "rest") {
      throw new AppError("ENGINE_UNSUPPORTED", "requests need a REST adapter", { reason: "tier" });
    }
    return adapter;
  };
  const find = (
    adapter: AdapterRecord,
    id: string
  ): ReturnType<RestRepository["byId"]> & object => {
    const request = repo.byId(id);
    if (request === null || request.adapter_id !== adapter.id) throw notFound("request");
    return request;
  };
  const sealHeaders = (id: string, secrets: Record<string, string>): Promise<Sealed | null> =>
    Object.keys(secrets).length === 0
      ? Promise.resolve(null)
      : seal(deps.ring, JSON.stringify(secrets), aadFor("rest_requests", HEADERS_COLUMN, id));
  const openHeaders = async (id: string, sealed: Sealed | null): Promise<Record<string, string>> =>
    sealed === null
      ? {}
      : v.parse(
          secretsSchema,
          JSON.parse(await open(deps.ring, sealed, aadFor("rest_requests", HEADERS_COLUMN, id)))
        );

  const send = async (
    adapter: AdapterRecord,
    request: RestRequest & { headers_sealed: Sealed | null },
    ctx: RunContext,
    slug: string
  ): Promise<OutboundResponse> => {
    const config = v.parse(httpConfigSchema, adapter.config);
    const placeholders: Placeholders = { ...ctx.placeholders, project: { slug } };
    const url = new URL(expand(request.path, placeholders), config.base_url);
    for (const [key, value] of expandEntries(request.query, placeholders))
      url.searchParams.set(key, value);
    const verdict = await deps.netguard.check({
      host: url.hostname,
      port: Number(url.port) || (url.protocol === "https:" ? 443 : 80),
      purpose: "rest",
    });
    if (!verdict.allowed)
      throw new AppError("HOST_BLOCKED", `${url.hostname} is blocked`, { reason: verdict.reason });
    const adapterSecrets = await openSecrets(
      deps.ring,
      adapter.id,
      CONFIG_COLUMN,
      adapter.config_sealed
    );
    const headers = {
      ...config.default_headers,
      ...adapterSecrets,
      ...Object.fromEntries(expandEntries(request.headers, placeholders)),
      ...(await openHeaders(request.id, request.headers_sealed)),
    };
    return sendRequest({
      url,
      method: request.method,
      headers,
      body: request.body === null ? null : expand(request.body, placeholders),
      timeoutMs: config.timeout_ms,
      verifyTls: config.verify_tls,
      bodyCapBytes: deps.bodyCapBytes ?? DEFAULT_BODY_CAP,
    });
  };

  return {
    async list(slug, adapterId) {
      return repo.list(adapterOf(slug, adapterId).id).map(toPublic);
    },
    async create(slug, adapterId, input) {
      const adapter = adapterOf(slug, adapterId);
      checkAll(input);
      if (repo.byName(adapter.id, input.name) !== null)
        throw conflict("request name is taken", { name: input.name });
      const id = Bun.randomUUIDv7();
      return toPublic(
        repo.insert({
          id,
          adapter_id: adapter.id,
          name: input.name,
          method: input.method,
          path: input.path,
          query: input.query,
          headers: input.headers,
          headers_sealed: await sealHeaders(id, input.secrets),
          secret_headers: Object.keys(input.secrets).sort(),
          body: input.body,
          expected_status: input.expected_status,
          created_at: nowIso(),
        })
      );
    },
    async get(slug, adapterId, id) {
      return toPublic(find(adapterOf(slug, adapterId), id));
    },
    async update(slug, adapterId, id, input) {
      const adapter = adapterOf(slug, adapterId);
      const current = find(adapter, id);
      checkAll(input);
      const renamed =
        input.name !== undefined && input.name.toLowerCase() !== current.name.toLowerCase();
      if (renamed && repo.byName(adapter.id, input.name ?? "") !== null) {
        throw conflict("request name is taken", { name: input.name ?? "" });
      }
      const patch = patchOf(input);
      if (input.secrets !== undefined) {
        const merged = mergeSecrets(
          await openHeaders(current.id, current.headers_sealed),
          input.secrets
        );
        patch.headers_sealed = await sealHeaders(current.id, merged);
        patch.secret_headers = Object.keys(merged).sort();
      }
      repo.update(current.id, patch, nowIso());
      return toPublic(find(adapter, id));
    },
    async remove(slug, adapterId, id) {
      const request = find(adapterOf(slug, adapterId), id);
      if (repo.referencedByHook(request.id)) throw conflict("a hook references this request");
      repo.remove(request.id);
    },
    async run(slug, adapterId, id, ctx) {
      const adapter = adapterOf(slug, adapterId);
      const request = find(adapter, id);
      const startedAt = Date.now();
      const base = {
        id: Bun.randomUUIDv7(),
        request_id: request.id,
        job_id: ctx.jobId ?? null,
        hook_run_id: ctx.hookRunId ?? null,
        created_at: nowIso(),
      };
      try {
        const response = await send(adapter, request, ctx, slug);
        return repo.insertRun({
          ...base,
          status_code: response.status_code,
          duration_ms: response.duration_ms,
          response_headers: response.response_headers,
          response_body: response.response_body,
          truncated: response.truncated,
          matched_expected:
            request.expected_status === null
              ? null
              : response.status_code === request.expected_status,
          error: null,
        });
      } catch (cause: unknown) {
        if (cause instanceof AppError) throw cause;
        const message = cause instanceof Error ? cause.message : String(cause);
        repo.insertRun({
          ...base,
          status_code: null,
          duration_ms: Date.now() - startedAt,
          response_headers: {},
          response_body: null,
          truncated: false,
          matched_expected: request.expected_status === null ? null : false,
          error: message,
        });
        throw new AppError("ADAPTER_UNREACHABLE", message, { run_id: base.id });
      }
    },
    async runs(slug, adapterId, id, limit) {
      return repo.runs(find(adapterOf(slug, adapterId), id).id, limit);
    },
    async runDetail(slug, adapterId, id, runId) {
      const run = repo.run(find(adapterOf(slug, adapterId), id).id, runId);
      if (run === null) throw notFound("run");
      return run;
    },
  };
}

export type { JsonObject };

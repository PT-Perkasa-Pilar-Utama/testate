/**
 * The `ingest` engine's write side (#75; Q4b, I1, I3a, I4, I5, I8 of
 * docs/decisions/2026-10-10-logs-tier.md): its token, a push, rotation, clearing, and the sweep.
 * Reading goes through the logs service like every other log adapter.
 */
import type { Actor, IngestAnswer, IngestToken } from "@testate/shared";
import { ingestConfigSchema } from "@testate/shared";
import * as v from "valibot";

import { AppError, notFound, rateLimited, unauthorized } from "../../lib/http/index.ts";
import type { RequestMeta } from "../../lib/http/auth.ts";
import { createRateLimiter } from "../../lib/http/ratelimit.ts";
import type { IngestStore } from "../../lib/logs/ingest/store.ts";
import { randomSecret, sha256 } from "../../lib/password/index.ts";
import { adapterRecorder } from "../adapters/adapters.helpers.ts";
import type { AdapterRecord, AdaptersRepository } from "../adapters/adapters.repository.ts";
import type { AuditService } from "../audit/audit.service.ts";
import type { ProjectsRepository } from "../projects/projects.repository.ts";
import type { IngestTokensRepository } from "./ingest.repository.ts";

/** `last_used_at` is written at most once a minute, as API tokens do: a push is not a write to it. */
const TOUCH_INTERVAL_MS = 60 * 1000;

export type IngestDeps = {
  tokens: IngestTokensRepository;
  adapters: Pick<AdaptersRepository, "byId" | "all">;
  projects: Pick<ProjectsRepository, "bySlug">;
  store: IngestStore;
  audit: AuditService;
  /** `limits.ingest_requests_per_minute`, read on every push so a change applies at once (I4). */
  budget: () => Promise<number>;
  now: () => Date;
};

export type IngestService = {
  /** A new token for the adapter, replacing any before it; the secret is returned once. */
  mint(adapterId: string): IngestToken;
  /** The adapter a token may push to, its budget charged; any refusal is `UNAUTHORIZED` or 429. */
  authorize(token: string, adapterId: string): Promise<AdapterRecord>;
  /** Stores an authorized push's body under the adapter's cap. */
  write(adapter: AdapterRecord, body: string): Promise<IngestAnswer>;
  rotate(
    actor: Actor,
    slug: string,
    adapterId: string,
    scope: string[] | null,
    meta: RequestMeta
  ): IngestToken;
  clear(
    actor: Actor,
    slug: string,
    adapterId: string,
    scope: string[] | null,
    meta: RequestMeta
  ): Promise<void>;
  /** Days past each adapter's retention, and every deleted adapter's folder. */
  sweep(): Promise<number>;
};

const isIngest = (adapter: AdapterRecord | null): adapter is AdapterRecord =>
  adapter !== null && adapter.engine === "ingest";

export function createIngestService(deps: IngestDeps): IngestService {
  const limiter = createRateLimiter(deps.now);
  const nowIso = (): string => deps.now().toISOString();

  const mint = (adapterId: string): IngestToken => {
    const token = `tsi_${randomSecret()}`;
    const prefix = token.slice(4, 12);
    deps.tokens.put({
      adapter_id: adapterId,
      token_hash: sha256(token),
      prefix,
      created_at: nowIso(),
    });
    return { token, prefix };
  };

  /** The project's ingest adapter, within the caller's scope; anything else is not found. */
  const ingestOf = (slug: string, adapterId: string, scope: string[] | null): AdapterRecord => {
    const project = deps.projects.bySlug(slug);
    if (project === null || (scope !== null && !scope.includes(project.id)))
      throw notFound("project");
    const adapter = deps.adapters.byId(adapterId);
    if (adapter === null || adapter.project_id !== project.id) throw notFound("adapter");
    if (!isIngest(adapter))
      throw new AppError("ENGINE_UNSUPPORTED", "only an ingest adapter takes pushed logs", {
        reason: "engine",
      });
    return adapter;
  };

  const record = adapterRecorder(deps.audit);

  return {
    mint,
    async authorize(token, adapterId) {
      // One answer for every refusal, so a wrong token says nothing about which adapters exist.
      const found = token.startsWith("tsi_") ? deps.tokens.byHash(sha256(token)) : null;
      const adapter = found === null ? null : deps.adapters.byId(found.adapter_id);
      if (found === null || found.adapter_id !== adapterId || !isIngest(adapter))
        throw unauthorized();
      const wait = limiter.hit(adapterId, await deps.budget());
      if (wait !== null) throw rateLimited(wait);
      const lastUsed = found.last_used_at === null ? 0 : Date.parse(found.last_used_at);
      if (deps.now().getTime() - lastUsed >= TOUCH_INTERVAL_MS)
        deps.tokens.touch(adapterId, nowIso());
      return adapter;
    },
    write(adapter, body) {
      return deps.store.write(adapter.id, body, v.parse(ingestConfigSchema, adapter.config).cap_mb);
    },
    rotate(actor, slug, adapterId, scope, meta) {
      const adapter = ingestOf(slug, adapterId, scope);
      const minted = mint(adapter.id);
      record(actor, "adapter.ingest_token_rotated", adapter, slug, meta, { prefix: minted.prefix });
      return minted;
    },
    async clear(actor, slug, adapterId, scope, meta) {
      const adapter = ingestOf(slug, adapterId, scope);
      await deps.store.clear(adapter.id);
      record(actor, "adapter.logs_cleared", adapter, slug, meta, {});
    },
    async sweep() {
      const live = deps.adapters.all().filter((adapter) => adapter.engine === "ingest");
      let removed = 0;
      for (const adapter of live) {
        const config = v.parse(ingestConfigSchema, adapter.config);
        removed += await deps.store.prune(adapter.id, config.retention_days);
      }
      const ids = new Set(live.map((adapter) => adapter.id));
      for (const held of await deps.store.held()) if (!ids.has(held)) await deps.store.clear(held);
      return removed;
    },
  };
}

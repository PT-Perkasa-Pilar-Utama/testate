import type { Actor, ApiToken, Role } from "@testate/shared";

import type { RequestMeta, Resolved } from "../../lib/http/auth.ts";
import { AppError, forbidden, notFound, rateLimited } from "../../lib/http/index.ts";
import { createRateLimiter } from "../../lib/http/ratelimit.ts";
import { randomSecret, sha256 } from "../../lib/password/index.ts";
import type { AuditService } from "../audit/audit.service.ts";
import type { AuthRepository, TokensListQuery } from "./auth.repository.ts";

export type CreateTokenInput = {
  name: string;
  kind: ApiToken["kind"];
  role?: Role;
  project_ids: string[] | null;
  expires_at?: string;
};

export type TokenService = {
  fromBearer(token: string): Promise<Resolved | null>;
  listTokens(query: TokensListQuery): Promise<ApiToken[]>;
  totalTokens(query: TokensListQuery): Promise<number>;
  createToken(
    actor: Actor,
    input: CreateTokenInput,
    meta: RequestMeta
  ): Promise<{ token: string; record: ApiToken }>;
  revokeToken(actor: Actor, id: string, meta: RequestMeta): Promise<void>;
};

export type TokenDeps = {
  repo: AuthRepository;
  audit: AuditService;
  now: () => Date;
  /** Project existence check for `project_ids` (02 §2.7). */
  projectExists: (id: string) => boolean;
  /** `limits.token_requests_per_minute` from settings (16 §16.1); absent means no budget. */
  tokenBudget?: () => Promise<number>;
};

const DAY = 24 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 60 * 1000;
export const AGENT_DEFAULT_EXPIRY_MS = 90 * DAY;
export const AGENT_MAX_EXPIRY_MS = 365 * DAY;
const RANK = { viewer: 0, qa: 1, admin: 2 } as const satisfies Record<Role, number>;

function tokenActor(token: ApiToken): Actor {
  const agent = token.kind === "agent";
  return {
    kind: "token",
    id: token.id,
    label: `token:${token.name}`,
    role: agent ? "viewer" : token.role,
    agent,
  };
}

/** Bearer tokens: `tst_` plus 32 random bytes; SHA-256 stored, first eight characters shown (09 §9.3). */
export function createTokenService(deps: TokenDeps): TokenService {
  const limiter = createRateLimiter(deps.now);
  const { repo, audit } = deps;
  const nowMs = (): number => deps.now().getTime();
  const nowIso = (): string => deps.now().toISOString();

  const agentExpiry = (requested: string | undefined): string => {
    const limit = nowMs() + AGENT_MAX_EXPIRY_MS;
    if (requested === undefined) return new Date(nowMs() + AGENT_DEFAULT_EXPIRY_MS).toISOString();
    if (new Date(requested).getTime() > limit) {
      throw new AppError("VALIDATION_ERROR", "an expiry is at most a year away", {
        max: new Date(limit).toISOString(),
      });
    }
    return requested;
  };

  return {
    async fromBearer(token) {
      if (!token.startsWith("tst_")) return null;
      const record = repo.tokenByHash(sha256(token));
      if (record === null || record.revoked_at !== null) return null;
      if (record.expires_at !== null && new Date(record.expires_at).getTime() <= nowMs()) {
        return null;
      }
      const lastUsed = record.last_used_at === null ? 0 : new Date(record.last_used_at).getTime();
      if (nowMs() - lastUsed >= TOUCH_INTERVAL_MS) repo.touchToken(record.id, nowIso());
      if (deps.tokenBudget !== undefined) {
        const wait = limiter.hit(record.id, await deps.tokenBudget());
        if (wait !== null) throw rateLimited(wait);
      }
      return {
        actor: tokenActor(record),
        mustChangePassword: false,
        projectScope: record.project_ids,
      };
    },
    async totalTokens(query) {
      return repo.totalTokens(query);
    },
    async listTokens(query) {
      return repo.listTokens(query);
    },
    async createToken(actor, input, meta) {
      const agent = input.kind === "agent";
      const role: Role = agent ? "viewer" : (input.role ?? "viewer");
      if (RANK[role] > RANK[actor.role]) throw forbidden("role");
      const unknown = (input.project_ids ?? []).find((id) => !deps.projectExists(id));
      if (unknown !== undefined) throw notFound("project");
      const secret = `tst_${randomSecret()}`;
      const record = repo.insertToken({
        id: Bun.randomUUIDv7(),
        name: input.name,
        role,
        kind: input.kind,
        project_ids: input.project_ids,
        token_hash: sha256(secret),
        prefix: secret.slice(4, 12),
        created_by: actor.kind === "user" ? actor.id : null,
        expires_at: agent ? agentExpiry(input.expires_at) : (input.expires_at ?? null),
        created_at: nowIso(),
      });
      audit.record({
        actor,
        action: "token.created",
        target_type: "api_token",
        target_id: record.id,
        target_label: record.name,
        details: { name: record.name, kind: record.kind, role: record.role },
        outcome: "succeeded",
        meta,
      });
      return { token: secret, record };
    },
    async revokeToken(actor, id, meta) {
      const record = repo.tokenById(id);
      if (record === null) throw notFound("token");
      repo.revokeToken(id, nowIso());
      audit.record({
        actor,
        action: "token.revoked",
        target_type: "api_token",
        target_id: id,
        target_label: record.name,
        details: { name: record.name },
        outcome: "succeeded",
        meta,
      });
    },
  };
}

import type { Actor, LoginInput, LoginResponse, Me } from "@testate/shared";

import type { ActorResolver, RequestMeta, Resolved } from "../../lib/http/auth.ts";
import { forbidden, notFound, rateLimited, unauthorized } from "../../lib/http/index.ts";
import { randomSecret, sha256 } from "../../lib/password/index.ts";
import type { PasswordHasher } from "../../lib/password/index.ts";
import type { AuditService } from "../audit/audit.service.ts";
import type { UserRecord, UsersRepository } from "../users/users.repository.ts";
import type { AuthRepository, SessionRecord } from "./auth.repository.ts";
import { createTokenService } from "./auth.tokens.ts";
import type { TokenService } from "./auth.tokens.ts";

export type { CreateTokenInput } from "./auth.tokens.ts";

export type SessionView = {
  id: string;
  created_at: string;
  last_seen_at: string;
  ip: string | null;
  user_agent: string | null;
  current: boolean;
};

export type AuthService = ActorResolver &
  TokenService & {
    login(
      input: LoginInput,
      meta: RequestMeta
    ): Promise<{ sessionToken: string; response: LoginResponse }>;
    logout(sessionToken: string, actor: Actor | null, meta: RequestMeta): Promise<void>;
    me(resolved: Resolved, env: string): Me;
    changePassword(
      actor: Actor,
      current: string,
      next: string,
      sessionToken: string | undefined,
      meta: RequestMeta
    ): Promise<void>;
    sessions(actor: Actor, sessionToken: string | undefined): Promise<SessionView[]>;
    revokeSession(actor: Actor, id: string): Promise<void>;
  };

export type AuthDeps = {
  users: UsersRepository;
  repo: AuthRepository;
  audit: AuditService;
  password: PasswordHasher;
  now: () => Date;
  projectExists: (id: string) => boolean;
};

const HOUR = 60 * 60 * 1000;
export const SESSION_IDLE_MS = 12 * HOUR;
export const SESSION_ABSOLUTE_MS = 7 * 24 * HOUR;
export const LOCKOUT_ATTEMPTS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;
const TOUCH_INTERVAL_MS = 60 * 1000;

function userActor(user: UserRecord): Actor {
  return { kind: "user", id: user.id, label: user.username, role: user.role, agent: false };
}

function envOf(env: string): Me["env"] {
  return env === "development" || env === "test" ? env : "production";
}

/** Sessions expire 12 h after the last touch, and 7 d after creation whatever happens (09 §9.6). */
function sessionExpiry(now: number, createdAt: string): string {
  return new Date(
    Math.min(now + SESSION_IDLE_MS, new Date(createdAt).getTime() + SESSION_ABSOLUTE_MS)
  ).toISOString();
}

function sessionView(session: SessionRecord, currentHash: string | null): SessionView {
  return {
    id: session.id,
    created_at: session.created_at,
    last_seen_at: session.last_seen_at,
    ip: session.ip,
    user_agent: session.user_agent,
    current: session.token_hash === currentHash,
  };
}

export function createAuthService(deps: AuthDeps): AuthService {
  const { users, repo, audit, password } = deps;
  const nowMs = (): number => deps.now().getTime();
  const nowIso = (): string => deps.now().toISOString();
  const tokens = createTokenService({
    repo,
    audit,
    now: deps.now,
    projectExists: deps.projectExists,
  });

  const failLogin = (user: UserRecord, meta: RequestMeta): void => {
    const count = user.failed_login_count + 1;
    const locked = count >= LOCKOUT_ATTEMPTS;
    const lockedUntil = locked ? new Date(nowMs() + LOCKOUT_MS).toISOString() : null;
    users.recordFailure(user.id, locked ? 0 : count, lockedUntil, nowIso());
    audit.record({
      actor: null,
      action: "auth.login_failed",
      target_type: "user",
      target_id: user.id,
      details: { username: user.username, failed_login_count: count },
      outcome: "failed",
      meta,
    });
    if (!locked) return;
    audit.record({
      actor: null,
      action: "auth.locked",
      target_type: "user",
      target_id: user.id,
      details: { username: user.username, locked_until: lockedUntil ?? "" },
      outcome: "failed",
      meta,
    });
  };

  const openSession = (user: UserRecord, meta: RequestMeta): string => {
    const secret = randomSecret();
    const created = nowIso();
    repo.insertSession({
      id: Bun.randomUUIDv7(),
      user_id: user.id,
      token_hash: sha256(secret),
      ip: meta.ip,
      user_agent: meta.user_agent,
      last_seen_at: created,
      expires_at: sessionExpiry(nowMs(), created),
      created_at: created,
    });
    return secret;
  };

  const requireUser = (actor: Actor): UserRecord => {
    if (actor.kind !== "user") throw forbidden("session_required");
    const user = users.byId(actor.id);
    if (user === null) throw unauthorized();
    return user;
  };

  /** Missing and disabled users fail exactly like a wrong password (02 §2.1). */
  const knownUser = (username: string, meta: RequestMeta): UserRecord => {
    const user = users.byUsername(username);
    if (user !== null && user.disabled_at === null) return user;
    audit.record({
      actor: null,
      action: "auth.login_failed",
      target_type: "user",
      target_id: username,
      details: { username, reason: user === null ? "unknown" : "disabled" },
      outcome: "failed",
      meta,
    });
    throw unauthorized();
  };

  return {
    ...tokens,
    async login(input, meta) {
      const user = knownUser(input.username, meta);
      const lockedUntil = user.locked_until === null ? 0 : new Date(user.locked_until).getTime();
      if (lockedUntil > nowMs()) throw rateLimited(Math.ceil((lockedUntil - nowMs()) / 1000));
      if (!(await password.verify(input.password, user.password_hash))) {
        failLogin(user, meta);
        throw unauthorized();
      }
      users.recordLogin(user.id, nowIso());
      const sessionToken = openSession(user, meta);
      audit.record({
        actor: userActor(user),
        action: "auth.login",
        target_type: "user",
        target_id: user.id,
        outcome: "succeeded",
        meta,
      });
      const { id, username, display_name, role } = user;
      return {
        sessionToken,
        response: {
          user: { id, username, display_name, role },
          must_change_password: user.must_change_password,
        },
      };
    },
    async logout(sessionToken, actor, meta) {
      const session = repo.sessionByHash(sha256(sessionToken));
      if (session === null) return;
      repo.deleteSession(session.id);
      audit.record({
        actor,
        action: "auth.logout",
        target_type: "session",
        target_id: session.id,
        outcome: "succeeded",
        meta,
      });
    },
    async fromSession(cookieValue) {
      const session = repo.sessionByHash(sha256(cookieValue));
      if (session === null) return null;
      if (new Date(session.expires_at).getTime() <= nowMs()) {
        repo.deleteSession(session.id);
        return null;
      }
      const user = users.byId(session.user_id);
      if (user === null || user.disabled_at !== null) return null;
      if (nowMs() - new Date(session.last_seen_at).getTime() >= TOUCH_INTERVAL_MS) {
        repo.touchSession(session.id, nowIso(), sessionExpiry(nowMs(), session.created_at));
      }
      return {
        actor: userActor(user),
        mustChangePassword: user.must_change_password,
        projectScope: null,
      };
    },
    me(resolved, env) {
      const me: Me = {
        actor: resolved.actor,
        must_change_password: resolved.mustChangePassword,
        project_scope: resolved.projectScope,
      };
      return resolved.actor.role === "admin" ? { ...me, env: envOf(env) } : me;
    },
    async changePassword(actor, current, next, sessionToken, meta) {
      const user = requireUser(actor);
      if (!(await password.verify(current, user.password_hash))) throw unauthorized();
      users.setPassword(user.id, await password.hash(next), false, nowIso());
      const keep = sessionToken === undefined ? null : repo.sessionByHash(sha256(sessionToken));
      const revoked =
        keep === null
          ? repo.deleteUserSessions(user.id)
          : repo.deleteUserSessions(user.id, keep.id);
      audit.record({
        actor,
        action: "auth.password_changed",
        target_type: "user",
        target_id: user.id,
        details: { sessions_revoked: revoked },
        outcome: "succeeded",
        meta,
      });
    },
    async sessions(actor, sessionToken) {
      const user = requireUser(actor);
      const currentHash = sessionToken === undefined ? null : sha256(sessionToken);
      return repo.listSessions(user.id).map((session) => sessionView(session, currentHash));
    },
    async revokeSession(actor, id) {
      const user = requireUser(actor);
      const session = repo.sessionById(id);
      if (session === null || session.user_id !== user.id) throw notFound("session");
      repo.deleteSession(id);
    },
  };
}

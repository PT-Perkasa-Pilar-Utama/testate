import type { Actor, ApiToken, LoginInput, LoginResponse, Me } from "@testate/shared";

import type { ActorResolver } from "../../lib/http/auth.ts";
import { AppError, notFound, unauthorized } from "../../lib/http/index.ts";
import { QA_ACTOR, TOKEN_ACTOR } from "../../lib/mock/fixtures.ts";
import {
  CREATE_TOKEN_RESPONSE_MOCK,
  LOGIN_RESPONSE_MOCK,
  SESSION_MOCK,
  TOKEN_MOCK,
} from "./auth.mock.ts";

export type AuthService = ActorResolver & {
  login(input: LoginInput): Promise<{ sessionToken: string; response: LoginResponse }>;
  logout(sessionToken: string): Promise<void>;
  me(actor: Actor, env: string): Me;
  changePassword(actor: Actor, current: string, next: string): Promise<void>;
  sessions(actor: Actor): Promise<(typeof SESSION_MOCK)[]>;
  revokeSession(actor: Actor, id: string): Promise<void>;
  listTokens(): Promise<ApiToken[]>;
  createToken(): Promise<typeof CREATE_TOKEN_RESPONSE_MOCK>;
  revokeToken(id: string): Promise<void>;
};

export type AuthDeps = {
  bootstrapUser: string;
  minPasswordLength: number;
};

/**
 * SCAFFOLD: in-memory sessions so the SPA and API tests have a real login flow. The card
 * that implements users and sessions replaces this with the metadata tables (06 §6.3).
 */
export function createAuthService(deps: AuthDeps): AuthService {
  const sessions = new Map<string, Actor>();
  const admin: Actor = {
    kind: "user",
    id: QA_ACTOR.id,
    label: deps.bootstrapUser,
    role: "admin",
    agent: false,
  };

  return {
    async login(input) {
      const known = input.username === deps.bootstrapUser || input.username === QA_ACTOR.label;
      if (!known || input.password.length < deps.minPasswordLength) throw unauthorized();
      const sessionToken = Bun.randomUUIDv7();
      const actor = input.username === deps.bootstrapUser ? admin : { ...QA_ACTOR };
      sessions.set(sessionToken, actor);
      const user = {
        ...LOGIN_RESPONSE_MOCK.user,
        id: actor.id,
        username: actor.label,
        role: actor.role,
      };
      return { sessionToken, response: { ...LOGIN_RESPONSE_MOCK, user } };
    },
    async logout(sessionToken) {
      sessions.delete(sessionToken);
    },
    async fromSession(cookieValue) {
      return sessions.get(cookieValue) ?? null;
    },
    async fromBearer(token) {
      if (!token.startsWith("tst_")) return null;
      return token.startsWith("tst_agent_")
        ? { ...TOKEN_ACTOR, role: "viewer", agent: true }
        : { ...TOKEN_ACTOR };
    },
    me(actor, env) {
      const me: Me = { actor, must_change_password: false, project_scope: null };
      return actor.role === "admin" ? { ...me, env: envOf(env) } : me;
    },
    async changePassword(_actor, current, next) {
      if (current === next) throw new AppError("VALIDATION_ERROR", "next must differ from current");
    },
    async sessions() {
      return [SESSION_MOCK];
    },
    async revokeSession(_actor, id) {
      if (id !== SESSION_MOCK.id) throw notFound("session");
    },
    async listTokens() {
      return [TOKEN_MOCK];
    },
    async createToken() {
      return CREATE_TOKEN_RESPONSE_MOCK;
    },
    async revokeToken(id) {
      if (id !== TOKEN_MOCK.id) throw notFound("token");
    },
  };
}

function envOf(env: string): Me["env"] {
  return env === "development" || env === "test" ? env : "production";
}

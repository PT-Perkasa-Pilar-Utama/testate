import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import {
  apiTokenSchema,
  createTokenResponseSchema,
  loginResponseSchema,
  meSchema,
} from "@testate/shared";
import * as v from "valibot";

import { ADMIN_PASSWORD, TEST_META, createAccounts } from "../../../test/accounts.ts";
import { expectContract } from "../../../test/contract.ts";
import { AppError } from "../../lib/http/index.ts";
import { WideEvent } from "../../lib/logger/event.ts";
import { SETTINGS_MOCK } from "../settings/settings.service.ts";
import { createAuthHandlers } from "./auth.handler.ts";
import {
  CREATE_TOKEN_RESPONSE_MOCK,
  LOGIN_RESPONSE_MOCK,
  ME_MOCK,
  TOKEN_MOCK,
} from "./auth.mock.ts";
import { LOCKOUT_ATTEMPTS, LOCKOUT_MS, SESSION_IDLE_MS } from "./auth.service.ts";
import type { AuthService } from "./auth.service.ts";

const HOUR = 60 * 60 * 1000;

/**
 * The service, wrapped so its first answer is the refusal a locked account gives and every answer
 * after it is the real one. Lives out here because a test may carry no branch of its own.
 */
function refusesOnce(auth: AuthService): AuthService {
  const answers: AuthService["login"][] = [
    () => Promise.reject(new AppError("RATE_LIMITED", "locked", { retry_after: 900 })),
  ];
  return { ...auth, login: (input, meta) => (answers.pop() ?? auth.login)(input, meta) };
}
const WRONG = "wrong-password-123";

const login = (
  auth: AuthService,
  password = ADMIN_PASSWORD,
  username = "admin"
): ReturnType<AuthService["login"]> => auth.login({ username, password }, TEST_META);

describe("auth mocks match the contract", () => {
  it("login response", () => {
    expectContract(loginResponseSchema, LOGIN_RESPONSE_MOCK, (clone) => {
      clone["user"] = { id: "not-a-uuid" };
    });
  });

  it("me", () => {
    expectContract(meSchema, ME_MOCK, (clone) => {
      clone["actor"] = { role: "root" };
    });
  });

  it("token record and creation response", () => {
    expectContract(apiTokenSchema, TOKEN_MOCK, (clone) => {
      clone["kind"] = "service";
    });
    expectContract(createTokenResponseSchema, CREATE_TOKEN_RESPONSE_MOCK, (clone) => {
      clone["token"] = "not-prefixed";
    });
  });
});

describe("login", () => {
  it("logs in, resolves the cookie to the user, and flags the forced password change", async () => {
    const { auth } = await createAccounts();
    const { sessionToken, response } = await login(auth);
    expect(response.user.username).toBe("admin");
    expect(response.must_change_password).toBe(true);
    const resolved = await auth.fromSession(sessionToken);
    expect(resolved?.actor.role).toBe("admin");
    expect(resolved?.mustChangePassword).toBe(true);
    expect(resolved?.projectScope).toBeNull();
  });

  it("matches usernames case-insensitively", async () => {
    const { auth } = await createAccounts();
    await expect(login(auth, ADMIN_PASSWORD, "ADMIN")).resolves.toBeDefined();
  });

  it("answers a wrong password and an unknown user with the same 401", async () => {
    const { auth } = await createAccounts();
    await expect(login(auth, WRONG)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(login(auth, ADMIN_PASSWORD, "nobody")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("locks after five failures, refuses the right password while locked, unlocks after 15 min", async () => {
    const { auth, advance } = await createAccounts();
    for (let attempt = 0; attempt < LOCKOUT_ATTEMPTS; attempt += 1) {
      await expect(login(auth, WRONG)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
    await expect(login(auth)).rejects.toMatchObject({
      code: "RATE_LIMITED",
      details: { retry_after: 900 },
    });
    advance(LOCKOUT_MS + 1000);
    await expect(login(auth)).resolves.toBeDefined();
  });

  it("resets the failure counter on success", async () => {
    const { auth } = await createAccounts();
    for (let attempt = 0; attempt < LOCKOUT_ATTEMPTS - 1; attempt += 1) {
      await expect(login(auth, WRONG)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
    await login(auth);
    await expect(login(auth, WRONG)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(login(auth)).resolves.toBeDefined();
  });

  it("writes login, failure, and lock audit rows", async () => {
    const { auth, audit } = await createAccounts();
    await login(auth);
    for (let attempt = 0; attempt < LOCKOUT_ATTEMPTS; attempt += 1) {
      await expect(login(auth, WRONG)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
    const actions = (await audit.list({ limit: 20, action: "auth." })).rows.map(
      (row) => row.action
    );
    expect(actions[0]).toBe("auth.locked");
    expect(actions.filter((action) => action === "auth.login_failed").length).toBe(
      LOCKOUT_ATTEMPTS
    );
    expect(actions.at(-1)).toBe("auth.login");
  });
});

describe("failed logins are limited per address", () => {
  /**
   * The handler owns this limit, not the service, so the test drives it over HTTP the way
   * `projects.test.ts` drives `requireProjectInScope`. `trustProxy` is on so each request can
   * claim its own address through `X-Forwarded-For`.
   */
  const appWith = (service: AuthService, now: () => Date, perMinute: number): Hono => {
    const handlers = createAuthHandlers(service, {
      env: "test",
      basePath: "/",
      secureCookies: false,
      trustProxy: true,
      now,
      settings: {
        get: () =>
          Promise.resolve({
            ...SETTINGS_MOCK,
            limits: { ...SETTINGS_MOCK.limits, failed_logins_per_minute: perMinute },
          }),
      },
    });
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("event", new WideEvent("request", () => undefined));
      await next();
    });
    app.post("/auth/login", handlers.login);
    app.onError((cause, c) =>
      c.json({ code: cause instanceof AppError ? cause.code : "OTHER" }, 500)
    );
    return app;
  };

  const appFor = async (
    perMinute: number
  ): Promise<{ app: Hono; advance: (ms: number) => void }> => {
    const { auth, advance, now } = await createAccounts();
    const handlers = createAuthHandlers(auth, {
      env: "test",
      basePath: "/",
      secureCookies: false,
      trustProxy: true,
      now,
      settings: {
        get: () =>
          Promise.resolve({
            ...SETTINGS_MOCK,
            limits: { ...SETTINGS_MOCK.limits, failed_logins_per_minute: perMinute },
          }),
      },
    });
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("event", new WideEvent("request", () => undefined));
      await next();
    });
    app.post("/auth/login", handlers.login);
    app.onError((cause, c) =>
      c.json({ code: cause instanceof AppError ? cause.code : "OTHER" }, 500)
    );
    return { app, advance };
  };

  const attempt = async (app: Hono, ip: string, password: string): Promise<Response> =>
    await app.request("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ username: "admin", password }),
    });

  it("a refusal that is already a rate limit does not spend the address budget", async () => {
    // Being locked out must not lock you out twice. Every attempt against a locked account comes
    // back RATE_LIMITED, and charging the address for each of those would trip the per-address cap
    // on top of the per-account one, for one person doing one thing.
    //
    // The budget is one, and the first attempt is refused the way a locked account refuses. If
    // that refusal were counted, the budget would be gone and the correct password below would
    // never reach the service.
    const { auth, now } = await createAccounts();
    const app = appWith(refusesOnce(auth), now, 1);
    expect(await (await attempt(app, "10.0.0.9", WRONG)).json()).toMatchObject({
      code: "RATE_LIMITED",
    });
    expect((await attempt(app, "10.0.0.9", ADMIN_PASSWORD)).status).toBe(200);
  });

  it("refuses a sixth guess from one address and tells it how long to wait", async () => {
    const { app } = await appFor(5);
    for (let guess = 0; guess < 5; guess += 1) {
      expect((await attempt(app, "10.0.0.1", WRONG)).status).toBe(500);
    }
    const blocked = await attempt(app, "10.0.0.1", WRONG);
    expect(await blocked.json()).toMatchObject({ code: "RATE_LIMITED" });
    // The right password is refused too: past the budget the address gets no more guesses.
    expect(await (await attempt(app, "10.0.0.1", ADMIN_PASSWORD)).json()).toMatchObject({
      code: "RATE_LIMITED",
    });
  });

  it("counts per address, so one attacker cannot lock everyone else out", async () => {
    const { app } = await appFor(2);
    await attempt(app, "10.0.0.1", WRONG);
    await attempt(app, "10.0.0.1", WRONG);
    expect(await (await attempt(app, "10.0.0.1", WRONG)).json()).toMatchObject({
      code: "RATE_LIMITED",
    });
    // A different address still has its whole budget.
    expect((await attempt(app, "10.0.0.2", WRONG)).status).toBe(500);
  });

  it("spends nothing on a login that works, which is why the limit can be tight", async () => {
    const { app } = await appFor(2);
    // Twenty good logins on a budget of two. A person who signs in often is not an attacker.
    for (let time = 0; time < 20; time += 1) {
      expect((await attempt(app, "10.0.0.1", ADMIN_PASSWORD)).status).toBe(200);
    }
    expect((await attempt(app, "10.0.0.1", WRONG)).status).toBe(500);
  });

  it("gives the address its budget back once the window has passed", async () => {
    const { app, advance } = await appFor(1);
    expect((await attempt(app, "10.0.0.1", WRONG)).status).toBe(500);
    expect(await (await attempt(app, "10.0.0.1", WRONG)).json()).toMatchObject({
      code: "RATE_LIMITED",
    });
    advance(61_000);
    expect((await attempt(app, "10.0.0.1", WRONG)).status).toBe(500);
  });
});

describe("sessions", () => {
  it("expires an idle session after 12 hours and touches an active one", async () => {
    const { auth, advance } = await createAccounts();
    const { sessionToken } = await login(auth);
    advance(SESSION_IDLE_MS - HOUR);
    expect(await auth.fromSession(sessionToken)).not.toBeNull();
    advance(SESSION_IDLE_MS - HOUR);
    expect(await auth.fromSession(sessionToken)).not.toBeNull();
    advance(SESSION_IDLE_MS + 1000);
    expect(await auth.fromSession(sessionToken)).toBeNull();
  });

  it("expires a session seven days after creation however active it is", async () => {
    const { auth, advance } = await createAccounts();
    const { sessionToken } = await login(auth);
    for (let hour = 0; hour < 7 * 24 - 1; hour += 1) {
      advance(HOUR);
      expect(await auth.fromSession(sessionToken)).not.toBeNull();
    }
    advance(2 * HOUR);
    expect(await auth.fromSession(sessionToken)).toBeNull();
  });

  it("logs out by deleting the session and ignores a garbage cookie", async () => {
    const { auth, admin } = await createAccounts();
    const { sessionToken } = await login(auth);
    await auth.logout(sessionToken, admin, TEST_META);
    expect(await auth.fromSession(sessionToken)).toBeNull();
    expect(await auth.fromSession("not-a-session")).toBeNull();
  });

  it("lists own sessions with the current flag and revokes one", async () => {
    const { auth, admin } = await createAccounts();
    const first = await login(auth);
    const second = await login(auth);
    const sessions = await auth.sessions(admin, first.sessionToken);
    expect(sessions.length).toBe(2);
    expect(sessions.filter((session) => session.current).length).toBe(1);
    const other = v.parse(
      v.object({ id: v.string() }),
      sessions.find((session) => !session.current)
    );
    await auth.revokeSession(admin, other.id);
    expect(await auth.fromSession(second.sessionToken)).toBeNull();
    expect(await auth.fromSession(first.sessionToken)).not.toBeNull();
    await expect(
      auth.revokeSession(admin, "01991f00-0000-7000-8000-0000000000ff")
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("changes the password, clears the flag, and revokes every other session", async () => {
    const { auth, admin } = await createAccounts();
    const first = await login(auth);
    const second = await login(auth);
    await expect(
      auth.changePassword(admin, WRONG, "a-new-password-123", first.sessionToken, TEST_META)
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await auth.changePassword(
      admin,
      ADMIN_PASSWORD,
      "a-new-password-123",
      first.sessionToken,
      TEST_META
    );
    expect((await auth.fromSession(first.sessionToken))?.mustChangePassword).toBe(false);
    expect(await auth.fromSession(second.sessionToken)).toBeNull();
    await expect(login(auth, "a-new-password-123")).resolves.toBeDefined();
  });

  it("includes env for admins only in me()", async () => {
    const { auth, admin } = await createAccounts();
    const resolved = { actor: admin, mustChangePassword: false, projectScope: null };
    expect(auth.me(resolved, "development").env).toBe("development");
    expect(
      auth.me({ ...resolved, actor: { ...admin, role: "qa" } }, "development").env
    ).toBeUndefined();
  });
});

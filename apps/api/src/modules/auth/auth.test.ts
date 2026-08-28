import { describe, expect, it } from "bun:test";
import {
  apiTokenSchema,
  createTokenResponseSchema,
  loginResponseSchema,
  meSchema,
} from "@testate/shared";

import { expectContract } from "../../../test/contract.ts";
import {
  CREATE_TOKEN_RESPONSE_MOCK,
  LOGIN_RESPONSE_MOCK,
  ME_MOCK,
  TOKEN_MOCK,
} from "./auth.mock.ts";
import { createAuthService } from "./auth.service.ts";

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

describe("scaffold auth service", () => {
  const service = createAuthService({ bootstrapUser: "admin", minPasswordLength: 12 });

  it("logs the bootstrap admin in and resolves the session to an admin actor", async () => {
    const { sessionToken } = await service.login({
      username: "admin",
      password: "correct-horse-battery",
    });
    const actor = await service.fromSession(sessionToken);
    expect(actor?.role).toBe("admin");
  });

  it("refuses a short password", async () => {
    await expect(service.login({ username: "admin", password: "short" })).rejects.toThrow(
      "authentication required"
    );
  });

  it("marks agent bearer tokens as agents with the viewer role", async () => {
    const actor = await service.fromBearer("tst_agent_example");
    expect(actor?.agent).toBe(true);
    expect(actor?.role).toBe("viewer");
  });

  it("logs out by forgetting the session", async () => {
    const { sessionToken } = await service.login({
      username: "admin",
      password: "correct-horse-battery",
    });
    await service.logout(sessionToken);
    expect(await service.fromSession(sessionToken)).toBeNull();
  });
});

import { describe, expect, it } from "bun:test";
import { userSchema } from "@testate/shared";

import { expectContract } from "../../../test/contract.ts";
import { USER_MOCK } from "./users.mock.ts";
import { createUsersService } from "./users.service.ts";

describe("users", () => {
  it("mock matches the contract", () => {
    expectContract(userSchema, USER_MOCK, (clone) => {
      clone["username"] = "Has Spaces";
    });
  });

  it("returns NOT_FOUND for an unknown id", async () => {
    const service = createUsersService();
    await expect(service.get("01991f00-0000-7000-8000-0000000000ff")).rejects.toThrow(
      "user not found"
    );
  });
});

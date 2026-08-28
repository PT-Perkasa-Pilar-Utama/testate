import { describe, expect, it } from "bun:test";
import { hookSchema, restRequestSchema, restRunSchema } from "@testate/shared";

import { expectContract } from "../../../test/contract.ts";
import { REST_ADAPTER_ID } from "../../lib/mock/fixtures.ts";
import { HOOK_MOCK, REST_REQUEST_MOCK, REST_RUN_MOCK } from "./rest.mock.ts";
import { checkPlaceholders, createRestService } from "./rest.service.ts";

describe("rest", () => {
  it("mocks match the contract", () => {
    expectContract(restRequestSchema, REST_REQUEST_MOCK, (clone) => {
      clone["method"] = "FETCH";
    });
    expectContract(restRunSchema, REST_RUN_MOCK, (clone) => {
      clone["duration_ms"] = "fast";
    });
    expectContract(hookSchema, HOOK_MOCK, (clone) => {
      clone["trigger"] = "on_boot";
    });
  });

  it("accepts known placeholders and rejects unknown ones", () => {
    expect(() => checkPlaceholders("/x/{{state.name}}/{{job.id}}")).not.toThrow();
    expect(() => checkPlaceholders("/x/{{user.email}}")).toThrow(
      "unknown placeholder {{user.email}}"
    );
  });

  it("refuses to delete a request a hook references", async () => {
    const service = createRestService();
    await expect(service.remove(REST_ADAPTER_ID, REST_REQUEST_MOCK.id, true)).rejects.toThrow(
      "a hook references this request"
    );
  });
});

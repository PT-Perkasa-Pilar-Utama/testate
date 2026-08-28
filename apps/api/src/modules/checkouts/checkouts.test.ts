import { describe, expect, it } from "bun:test";
import { checkoutSchema, preflightSchema } from "@testate/shared";

import { expectContract } from "../../../test/contract.ts";
import { CHECKOUT_MOCK, PREFLIGHT_MOCK } from "./checkouts.mock.ts";
import { createCheckoutsService } from "./checkouts.service.ts";

describe("checkouts", () => {
  it("mocks match the contract", () => {
    expectContract(checkoutSchema, CHECKOUT_MOCK, (clone) => {
      clone["status"] = "done";
    });
    expectContract(preflightSchema, PREFLIGHT_MOCK, (clone) => {
      clone["adapters"] = [{ adapter_id: "x" }];
    });
  });

  it("refuses a checkout on drift unless forced", async () => {
    const service = createCheckoutsService();
    await expect(
      service.create("shop", { state_name: "seeded-baseline", force: false })
    ).rejects.toThrow("live schema differs from the state");
    const forced = await service.create("shop", { state_name: "seeded-baseline", force: true });
    expect(forced.checkout.force).toBe(true);
    expect(forced.job.kind).toBe("checkout");
  });

  it("retries only when an adapter did not reach restored", async () => {
    const service = createCheckoutsService();
    const retried = await service.retry("shop", CHECKOUT_MOCK.id);
    expect(retried.checkout.status).toBe("running");
  });
});

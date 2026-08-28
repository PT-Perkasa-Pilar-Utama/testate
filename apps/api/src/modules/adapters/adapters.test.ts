import { describe, expect, it } from "bun:test";
import { adapterDeletionPlanSchema, adapterSchema, probeResultSchema } from "@testate/shared";

import { expectContract } from "../../../test/contract.ts";
import {
  ADAPTER_DELETION_PLAN_MOCK,
  ADAPTER_MOCK,
  PROBE_MOCK,
  STORAGE_ADAPTER_MOCK,
} from "./adapters.mock.ts";
import { createAdaptersService } from "./adapters.service.ts";

describe("adapters", () => {
  it("mocks match the contract", () => {
    expectContract(adapterSchema, ADAPTER_MOCK, (clone) => {
      clone["credential"] = { set: true };
    });
    expectContract(adapterSchema, STORAGE_ADAPTER_MOCK, (clone) => {
      clone["tier"] = "bucket";
    });
    expectContract(probeResultSchema, PROBE_MOCK, (clone) => {
      clone["capabilities"] = {};
    });
    expectContract(adapterDeletionPlanSchema, ADAPTER_DELETION_PLAN_MOCK, (clone) => {
      clone["adapter"] = { action: "drop" };
    });
  });

  it("lets qa tighten but only admin loosen the mode", async () => {
    const service = createAdaptersService();
    const tightened = await service.setMode("shop", ADAPTER_MOCK.id, "read_only", "qa");
    expect(tightened.mode).toBe("read_only");
    await expect(service.setMode("shop", ADAPTER_MOCK.id, "sandbox", "qa")).rejects.toThrow(
      "forbidden"
    );
    const loosened = await service.setMode("shop", ADAPTER_MOCK.id, "sandbox", "admin");
    expect(loosened.mode).toBe("sandbox");
  });

  it("refuses a mode on a storage adapter", async () => {
    const service = createAdaptersService();
    await expect(
      service.setMode("shop", STORAGE_ADAPTER_MOCK.id, "sandbox", "admin")
    ).rejects.toThrow("only database adapters have a mode");
  });
});

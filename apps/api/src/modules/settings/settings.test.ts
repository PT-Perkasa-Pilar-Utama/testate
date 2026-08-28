import { describe, expect, it } from "bun:test";
import { settingsSchema } from "@testate/shared";

import { expectContract } from "../../../test/contract.ts";
import { SETTINGS_MOCK, createSettingsService } from "./settings.service.ts";

describe("settings", () => {
  it("mock matches the contract", () => {
    expectContract(settingsSchema, SETTINGS_MOCK, (clone) => {
      clone["retention"] = { stash_keep: 0 };
    });
  });

  it("refuses to change a key the environment locks", async () => {
    const service = createSettingsService();
    await expect(service.update(["limits.upload_mb"])).rejects.toThrow("is set by the environment");
  });

  it("refuses a store migration while jobs run", async () => {
    const service = createSettingsService();
    await expect(service.migrateStore(true)).rejects.toThrow("needs an idle instance");
  });
});

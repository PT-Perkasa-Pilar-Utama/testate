import { describe, expect, it } from "bun:test";
import { archiveManifestSchema, stateSchema, stateTreeNodeSchema } from "@testate/shared";
import * as v from "valibot";

import { expectContract } from "../../../test/contract.ts";
import { ARCHIVE_MANIFEST_MOCK, INIT_STATE_MOCK, STATE_MOCK, TREE_MOCK } from "./states.mock.ts";
import { createStatesService } from "./states.service.ts";

describe("states", () => {
  it("mocks match the contract", () => {
    expectContract(stateSchema, STATE_MOCK, (clone) => {
      clone["name"] = "01991f00-0000-7000-8000-000000000031";
    });
    expectContract(archiveManifestSchema, ARCHIVE_MANIFEST_MOCK, (clone) => {
      clone["adapters"] = [{ engine: "postgres" }];
    });
    expect(v.safeParse(v.array(stateTreeNodeSchema), TREE_MOCK).success).toBe(true);
  });

  it("hides stashes unless asked", async () => {
    const service = createStatesService();
    const visible = await service.list("shop", false);
    const all = await service.list("shop", true);
    expect(visible.every((state) => state.kind !== "stash")).toBe(true);
    expect(all.length).toBe(visible.length + 1);
  });

  it("resolves a state by name case-insensitively", async () => {
    const service = createStatesService();
    const detail = await service.get("shop", "SEEDED-BASELINE");
    expect(detail.id).toBe(STATE_MOCK.id);
  });

  it("refuses to delete a protected state and to unprotect an init state", async () => {
    const service = createStatesService();
    await expect(service.remove("shop", STATE_MOCK.id)).rejects.toThrow("state is protected");
    await expect(service.update("shop", INIT_STATE_MOCK.id, { protected: false })).rejects.toThrow(
      "init states stay protected"
    );
  });

  it("refuses a duplicate state name", async () => {
    const service = createStatesService();
    await expect(service.snapshot("shop", { name: "Seeded-Baseline" })).rejects.toThrow(
      "state name is taken"
    );
  });
});

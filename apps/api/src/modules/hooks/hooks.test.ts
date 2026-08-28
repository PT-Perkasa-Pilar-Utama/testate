import { describe, expect, it } from "bun:test";

import { HOOK_MOCK } from "../rest/rest.mock.ts";
import { createHooksService } from "./hooks.service.ts";

describe("hooks", () => {
  it("filters by trigger", async () => {
    const service = createHooksService();
    expect(await service.list("shop", "after_checkout")).toStrictEqual([HOOK_MOCK]);
    expect(await service.list("shop", "after_import")).toStrictEqual([]);
  });

  it("requires the complete ordered list on reorder", async () => {
    const service = createHooksService();
    await expect(service.reorder("shop", "after_checkout", [])).rejects.toThrow(
      "hook_ids must list every hook of the trigger exactly once"
    );
    expect(await service.reorder("shop", "after_checkout", [HOOK_MOCK.id])).toStrictEqual([
      HOOK_MOCK,
    ]);
  });
});

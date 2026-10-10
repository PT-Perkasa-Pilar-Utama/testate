import { describe, expect, it } from "bun:test";
import type { AdapterDraft, JsonValue } from "@testate/shared";

import { TEST_META } from "../../../test/accounts.ts";
import { createAdaptersHarness } from "../../../test/adapters.ts";
import { PM2_LOGS } from "../../../test/logs.ts";

// #69, Q3 and S1 (docs/decisions/2026-10-10-logs-tier.md): a logfile adapter only reads.
const withSources = (sources: JsonValue): AdapterDraft => ({
  ...PM2_LOGS,
  config: { ...PM2_LOGS.config, sources },
});

describe("a logfile adapter", () => {
  it("is a read-only Logs adapter with no init snapshot, and warns when a glob matches nothing", async () => {
    const { adapters, qa } = await createAdaptersHarness();
    const outcome = await adapters.testDraft("shop", PM2_LOGS);
    const { adapter, init_job } = await adapters.create(qa, "shop", PM2_LOGS, TEST_META);
    expect([adapter.kind, adapter.tier, adapter.mode, init_job]).toEqual([
      "logs",
      "logs",
      "read_only",
      null,
    ]);
    expect(outcome).toMatchObject({
      engine: "logfile",
      tier: "logs",
      warnings: [{ code: "no_files" }],
    });
  });

  it("refuses sandbox at creation and any mode change later, admins included", async () => {
    const { adapters, qa, admin } = await createAdaptersHarness();
    await expect(
      adapters.create(qa, "shop", { ...PM2_LOGS, mode: "sandbox" }, TEST_META)
    ).rejects.toMatchObject({
      code: "ENGINE_UNSUPPORTED",
    });
    const { adapter } = await adapters.create(qa, "shop", PM2_LOGS, TEST_META);
    await expect(
      adapters.setMode(admin, "shop", adapter.id, "sandbox", TEST_META)
    ).rejects.toMatchObject({
      code: "ENGINE_UNSUPPORTED",
    });
  });

  it("refuses a regex source with no pattern, a pattern that can stall, and another transport's secret", async () => {
    const { adapters, qa } = await createAdaptersHarness();
    const noPattern = withSources([{ name: "app", glob: "app.log", format: "regex" }]);
    const nested = withSources([
      { name: "app", glob: "app.log", format: "plain", patterns: ["(a+)+$"] },
    ]);
    const wrongSecret = { ...PM2_LOGS, secrets: { access_key_id: "AKIA", secret_access_key: "x" } };
    for (const draft of [noPattern, nested, wrongSecret]) {
      await expect(adapters.create(qa, "shop", draft, TEST_META)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
    }
  });
});

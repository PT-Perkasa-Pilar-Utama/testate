import { describe, expect, it } from "bun:test";

import { TEST_META } from "../../../test/accounts.ts";
import { PG, createSettled } from "../../../test/adapters.ts";
import { settingsSchema } from "@testate/shared";
import { expectContract } from "../../../test/contract.ts";
import { IDLE_SETTINGS_DEPS } from "../../../test/settings.ts";
import { createSettingsHarness } from "../../../test/settings-harness.ts";
import { createSettingsRepository } from "./settings.repository.ts";
import { SETTINGS_MOCK, createSettingsService, leavesOf } from "./settings.service.ts";

describe("settings", () => {
  it("mock matches the contract", () => {
    expectContract(settingsSchema, SETTINGS_MOCK, (clone) => {
      clone["retention"] = { stash_keep: 0 };
    });
  });

  it("reads defaults with the environment's locked values laid over", async () => {
    const h = await createSettingsHarness("s3");
    const settings = await h.settings.get();
    expect(settings.limits).toMatchObject({
      upload_mb: 7,
      job_concurrency: 3,
      query_rows_max: 5000,
    });
    expect(settings.store).toMatchObject({ driver: "s3", locked_by_env: true });
    expect(settings.locked_by_env).toEqual([
      "limits.upload_mb",
      "limits.job_concurrency",
      "store.driver",
      "store.s3",
    ]);
  });

  it("persists a patch, refuses locked keys, and flattens nested keys", async () => {
    const h = await createSettingsHarness();
    const updated = await h.settings.update(
      h.harness.admin,
      { retention: { stash_keep: 2 }, quota: { default_bytes: 1 } },
      TEST_META
    );
    expect(updated.retention.stash_keep).toBe(2);
    expect((await h.settings.get()).quota.default_bytes).toBe(1);
    await expect(
      h.settings.update(h.harness.admin, { limits: { upload_mb: 99 } }, TEST_META)
    ).rejects.toThrow("limits.upload_mb is set by the environment");
    expect(leavesOf({ a: { b: 1 }, log: { sample_rate_by_route: { x: 0.5 } } })).toEqual([
      ["a.b", 1],
      ["log.sample_rate_by_route", { x: 0.5 }],
    ]);
  });

  it("a deny list change re-checks every adapter and disables the blocked ones", async () => {
    const h = await createSettingsHarness();
    const adapter = await createSettled(h.harness, PG);
    const result = await h.settings.update(
      h.harness.admin,
      { netguard: { deny: ["pg.sit.internal"] } },
      TEST_META
    );
    expect(h.rechecks).toEqual([["pg.sit.internal"]]);
    expect(result.disabled_adapters).toEqual([adapter.id]);
    expect((await h.harness.adapters.get("shop", adapter.id)).status).toBe("disabled");
    const same = await h.settings.update(
      h.harness.admin,
      { netguard: { deny: ["pg.sit.internal"] } },
      TEST_META
    );
    expect(same.disabled_adapters).toBeUndefined();
  });

  it("the retention sweep prunes old history, audit rows, and surplus stashes", async () => {
    const h = await createSettingsHarness();
    await createSettled(h.harness, PG);
    h.harness.db
      .query(
        "INSERT INTO query_history (id, adapter_id, query_hash, query_text, mode, created_at) VALUES ('q1', 'a', 'h', 'SELECT 1', 'read', '2020-01-01T00:00:00.000Z')"
      )
      .run();
    const removed: string[] = [];
    const settings = createSettingsService({
      repo: createSettingsRepository(h.harness.db),
      config: { TESTATE_MAX_UPLOAD_MB: 7, TESTATE_JOB_CONCURRENCY: 3, TESTATE_STORE: undefined },
      audit: h.harness.audit,
      ...IDLE_SETTINGS_DEPS,
      recheckDenyList: async () => [],
      retention: {
        db: h.harness.db,
        removeState: async (id) => void removed.push(id),
        pruneAuditPayloads: () => 0,
        dataDir: h.harness.dataDir,
      },
      now: h.harness.now,
    });
    await settings.update(h.harness.admin, { retention: { stash_keep: 1 } }, TEST_META);
    for (const name of ["s1", "s2", "s3"]) {
      h.harness.db
        .query(
          "INSERT INTO states (id, project_id, name, kind, status, job_id, created_at, updated_at) SELECT ?, project_id, ?, 'stash', 'ready', 'j', ?, ? FROM states LIMIT 1"
        )
        .run(name, name, `2026-08-2${name.slice(-1)}T00:00:00.000Z`, "2026-08-29T00:00:00.000Z");
    }
    const report = await settings.runRetention();
    expect(report).toMatchObject({ query_history: 1, stashes: 2, import_runs: 0 });
    expect(removed).toEqual(["s2", "s1"]);
  });
});

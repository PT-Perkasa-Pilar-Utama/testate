import { describe, expect, it } from "bun:test";
import { diffRowSchema, diffSchema } from "@testate/shared";
import * as v from "valibot";

import { expectContract } from "../../../test/contract.ts";
import { STATE_INIT_ID } from "../../lib/mock/fixtures.ts";
import { DIFF_MOCK, DIFF_ROWS_MOCK } from "./diffs.mock.ts";
import { createDiffsService } from "./diffs.service.ts";

describe("diffs", () => {
  it("mocks match the contract", () => {
    expectContract(diffSchema, DIFF_MOCK, (clone) => {
      clone["adapters"] = [{ tables: "many" }];
    });
    expect(v.safeParse(v.array(diffRowSchema), DIFF_ROWS_MOCK).success).toBe(true);
  });

  it("filters rows by operation", async () => {
    const service = createDiffsService();
    const changed = await service.rows("shop", DIFF_MOCK.id, "changed");
    expect(changed.every((row) => row.op === "changed")).toBe(true);
    expect(changed.length).toBeLessThan(DIFF_ROWS_MOCK.length);
  });

  it("takes a hidden snapshot for a live target", async () => {
    const service = createDiffsService();
    const { diff, job } = await service.create("shop", STATE_INIT_ID, true);
    expect("live" in diff.target).toBe(true);
    expect(job.kind).toBe("diff");
  });
});

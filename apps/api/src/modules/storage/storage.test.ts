import { describe, expect, it } from "bun:test";
import { entrySchema, previewPayloadSchema } from "@testate/shared";
import * as v from "valibot";

import { expectContract } from "../../../test/contract.ts";
import { ADAPTER_ID, STORAGE_ADAPTER_ID } from "../../lib/mock/fixtures.ts";
import { ENTRIES_MOCK, PREVIEW_CSV_MOCK } from "./storage.mock.ts";
import { createStorageService } from "./storage.service.ts";

describe("storage", () => {
  it("mocks match the contract", () => {
    expect(v.safeParse(v.array(entrySchema), ENTRIES_MOCK).success).toBe(true);
    expectContract(previewPayloadSchema, PREVIEW_CSV_MOCK, (clone) => {
      clone["kind"] = "video";
    });
  });

  it("refuses browsing on a database adapter", async () => {
    const service = createStorageService();
    await expect(service.list(ADAPTER_ID, undefined, undefined)).rejects.toThrow(
      "browsing needs a Files adapter"
    );
  });

  it("filters a directory listing by name", async () => {
    const service = createStorageService();
    const entries = await service.list(STORAGE_ADAPTER_ID, "sit/exports", "2026-08-28");
    expect(entries.map((entry) => entry.name)).toStrictEqual(["export-2026-08-28.csv"]);
  });

  it("has no preview for a directory", async () => {
    const service = createStorageService();
    await expect(service.preview(STORAGE_ADAPTER_ID, "sit/exports")).rejects.toThrow(
      "directories have no preview"
    );
  });
});

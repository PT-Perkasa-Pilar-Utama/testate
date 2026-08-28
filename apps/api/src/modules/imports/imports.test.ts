import { describe, expect, it } from "bun:test";
import {
  importReportSchema,
  importRunSchema,
  mappingSchema,
  previewSchema,
  uploadSchema,
} from "@testate/shared";

import { expectContract } from "../../../test/contract.ts";
import { ADAPTER_MONGO_ID } from "../../lib/mock/fixtures.ts";
import {
  IMPORT_REPORT_MOCK,
  IMPORT_RUN_MOCK,
  MAPPING_MOCK,
  PREVIEW_MOCK,
  UPLOAD_MOCK,
} from "./imports.mock.ts";
import { createImportsService } from "./imports.service.ts";

describe("imports", () => {
  it("mocks match the contract", () => {
    expectContract(uploadSchema, UPLOAD_MOCK, (clone) => {
      clone["type"] = "pdf";
    });
    expectContract(previewSchema, PREVIEW_MOCK, (clone) => {
      clone["detected"] = {};
    });
    expectContract(mappingSchema, MAPPING_MOCK, (clone) => {
      clone["columns"] = [{ source: "Email", target: "email", transforms: [{ kind: "explode" }] }];
    });
    expectContract(importReportSchema, IMPORT_REPORT_MOCK, (clone) => {
      clone["inserted"] = "many";
    });
    expectContract(importRunSchema, IMPORT_RUN_MOCK, (clone) => {
      clone["mode"] = "merge";
    });
  });

  it("refuses an upload over the limit", async () => {
    const service = createImportsService();
    await expect(service.upload("big.csv", 60 * 1024 * 1024, 50 * 1024 * 1024)).rejects.toThrow(
      "upload exceeds the limit"
    );
  });

  it("refuses mappings on a document adapter", async () => {
    const service = createImportsService();
    await expect(service.listMappings(ADAPTER_MONGO_ID)).rejects.toThrow(
      "imports need a Tabular adapter"
    );
  });

  it("builds a sample with a header, an example row, and a schema block", async () => {
    const service = createImportsService();
    const sample = await service.sample(
      "01991f00-0000-7000-8000-000000000020",
      "public.customers",
      "csv"
    );
    const lines = sample.body.trim().split("\n");
    expect(lines[0]).toBe("email,joined_at,password_hash");
    expect(lines[2]?.startsWith("#")).toBe(true);
  });
});

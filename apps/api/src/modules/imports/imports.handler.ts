import { importRunRequestSchema, mappingBodySchema, previewRequestSchema } from "@testate/shared";
import * as v from "valibot";

import {
  AppError,
  accepted,
  ok,
  okPage,
  param,
  parseBody,
  parseQuery,
} from "../../lib/http/index.ts";
import type { Handler } from "../../lib/http/index.ts";
import type { ImportsService } from "./imports.service.ts";

export type ImportsHandlers = {
  upload: Handler;
  preview: Handler;
  listMappings: Handler;
  createMapping: Handler;
  getMapping: Handler;
  updateMapping: Handler;
  removeMapping: Handler;
  run: Handler;
  listRuns: Handler;
  report: Handler;
  rejectedRows: Handler;
  sample: Handler;
};

const sampleQuerySchema = v.object({
  format: v.array(v.picklist(["csv", "xlsx"])),
  mapping_id: v.optional(v.array(v.string())),
});

export function createImportsHandlers(
  service: ImportsService,
  apiPrefix: string,
  maxUploadBytes: number
): ImportsHandlers {
  return {
    upload: async (c) => {
      const form = await c.req.formData().catch(() => null);
      const file = form?.get("file");
      if (!(file instanceof File))
        throw new AppError("VALIDATION_ERROR", "multipart field `file` is required");
      return ok(c, await service.upload(file.name, file.size, maxUploadBytes), 201);
    },
    preview: async (c) => {
      await parseBody(c, previewRequestSchema);
      return ok(c, await service.preview());
    },
    listMappings: async (c) => okPage(c, await service.listMappings(param(c, "id")), null, 50),
    createMapping: async (c) => {
      const body = await parseBody(c, mappingBodySchema);
      return ok(c, await service.createMapping(param(c, "id"), body.name, body.target), 201);
    },
    getMapping: async (c) => ok(c, await service.getMapping(param(c, "id"), param(c, "mid"))),
    updateMapping: async (c) => {
      await parseBody(c, v.partial(mappingBodySchema));
      return ok(c, await service.updateMapping(param(c, "id"), param(c, "mid")));
    },
    removeMapping: async (c) => {
      await service.removeMapping(param(c, "id"), param(c, "mid"));
      return c.body(null, 204);
    },
    run: async (c) => {
      const body = await parseBody(c, importRunRequestSchema);
      return accepted(
        c,
        await service.run(param(c, "slug"), body.adapter_id, body.mapping_id, body.dry_run),
        apiPrefix
      );
    },
    listRuns: async (c) => okPage(c, await service.listRuns(param(c, "slug")), null, 50),
    report: async (c) => ok(c, await service.report(param(c, "slug"), param(c, "run_id"))),
    rejectedRows: async (c) => {
      const csv = await service.rejectedRows(param(c, "slug"), param(c, "run_id"));
      c.header("Content-Type", "text/csv; charset=utf-8");
      c.header("Content-Disposition", `attachment; filename="rejected-${param(c, "run_id")}.csv"`);
      return c.body(csv, 200);
    },
    sample: async (c) => {
      const query = parseQuery(c, sampleQuerySchema);
      const format = query.format[0] ?? "csv";
      const sample = await service.sample(param(c, "id"), param(c, "table"), format);
      c.header(
        "Content-Type",
        format === "csv"
          ? "text/csv; charset=utf-8"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      c.header("Content-Disposition", `attachment; filename="${sample.fileName}"`);
      return c.body(sample.body, 200);
    },
  };
}

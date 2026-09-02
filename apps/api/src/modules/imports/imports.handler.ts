import {
  importRunRequestSchema,
  normalizerBodySchema,
  previewRequestSchema,
} from "@testate/shared";
import * as v from "valibot";

import { currentActor, requestMeta } from "../../lib/http/auth.ts";
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
import { firstQuery } from "../../lib/http/query.ts";
import type { RunsFilter } from "./imports.repository.ts";
import type { ImportsService, NormalizerBody } from "./imports.service.ts";

export type ImportsHandlers = {
  upload: Handler;
  preview: Handler;
  listNormalizers: Handler;
  createNormalizer: Handler;
  getNormalizer: Handler;
  updateNormalizer: Handler;
  removeNormalizer: Handler;
  run: Handler;
  listRuns: Handler;
  report: Handler;
  rejectedRows: Handler;
  sample: Handler;
};

const sampleQuerySchema = v.object({
  format: v.array(v.picklist(["csv", "xlsx"])),
  normalizer_id: v.optional(v.array(v.string())),
});
const runsQuery = v.object({
  limit: v.optional(
    v.array(v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(1), v.maxValue(200)))
  ),
  adapter_id: v.optional(v.array(v.string())),
  dry_run: v.optional(v.array(v.picklist(["true", "false"]))),
});
const purposeSchema = v.optional(v.picklist(["import", "archive"]), "import");

/** Drops undefined fields so the patch matches exactOptionalPropertyTypes. */
function toPatch(
  body: v.InferOutput<ReturnType<typeof v.partial<typeof normalizerBodySchema>>>
): Partial<NormalizerBody> {
  const patch: Partial<NormalizerBody> = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.target !== undefined) patch.target = body.target;
  if (body.columns !== undefined) patch.columns = body.columns;
  if (body.key_columns !== undefined) patch.key_columns = body.key_columns;
  if (body.mode !== undefined) patch.mode = body.mode;
  if (body.options !== undefined) patch.options = body.options;
  return patch;
}

function toRunsFilter(parsed: v.InferOutput<typeof runsQuery>): RunsFilter {
  const filter: RunsFilter = { limit: firstQuery(parsed.limit) ?? 50 };
  const adapterId = firstQuery(parsed.adapter_id);
  if (adapterId !== undefined) filter.adapter_id = adapterId;
  const dryRun = firstQuery(parsed.dry_run);
  if (dryRun !== undefined) filter.dry_run = dryRun === "true";
  return filter;
}

export function createImportsHandlers(
  service: ImportsService,
  apiPrefix: string,
  trustProxy: boolean
): ImportsHandlers {
  const meta = (c: Parameters<Handler>[0]): ReturnType<typeof requestMeta> =>
    requestMeta(c, trustProxy);
  return {
    upload: async (c) => {
      const form = await c.req.formData().catch(() => null);
      const file = form?.get("file");
      if (!(file instanceof File))
        throw new AppError("VALIDATION_ERROR", "choose a file to upload");
      const purpose = v.parse(purposeSchema, form?.get("purpose") ?? undefined);
      return ok(c, await service.upload(param(c, "slug"), file, purpose), 201);
    },
    preview: async (c) =>
      ok(c, await service.preview(param(c, "slug"), await parseBody(c, previewRequestSchema))),
    listNormalizers: async (c) =>
      okPage(c, await service.listNormalizers(param(c, "id")), null, 50),
    createNormalizer: async (c) => {
      const body = await parseBody(c, normalizerBodySchema);
      return ok(c, await service.createNormalizer(currentActor(c), param(c, "id"), body), 201);
    },
    getNormalizer: async (c) => ok(c, await service.getNormalizer(param(c, "id"), param(c, "mid"))),
    updateNormalizer: async (c) => {
      const body = await parseBody(c, v.partial(normalizerBodySchema));
      return ok(c, await service.updateNormalizer(param(c, "id"), param(c, "mid"), toPatch(body)));
    },
    removeNormalizer: async (c) => {
      await service.removeNormalizer(param(c, "id"), param(c, "mid"));
      return c.body(null, 204);
    },
    run: async (c) => {
      const body = await parseBody(c, importRunRequestSchema);
      return accepted(
        c,
        await service.run(currentActor(c), param(c, "slug"), body, meta(c)),
        apiPrefix
      );
    },
    listRuns: async (c) => {
      const filter = toRunsFilter(parseQuery(c, runsQuery));
      return okPage(c, await service.listRuns(param(c, "slug"), filter), null, filter.limit);
    },
    report: async (c) => ok(c, await service.report(param(c, "slug"), param(c, "run_id"))),
    rejectedRows: async (c) => {
      const csv = await service.rejectedRows(param(c, "slug"), param(c, "run_id"));
      c.header("Content-Type", "text/csv; charset=utf-8");
      c.header("Content-Disposition", `attachment; filename="rejected-${param(c, "run_id")}.csv"`);
      return c.body(csv, 200);
    },
    sample: async (c) => {
      const query = parseQuery(c, sampleQuerySchema);
      const sample = await service.sample(
        param(c, "id"),
        param(c, "table"),
        query.format[0] ?? "csv",
        firstQuery(query.normalizer_id)
      );
      c.header(
        "Content-Type",
        sample.fileName.endsWith(".xlsx")
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "text/csv; charset=utf-8"
      );
      c.header("Content-Disposition", `attachment; filename="${sample.fileName}"`);
      return c.body(new Blob([sample.body]).stream(), 200);
    },
  };
}

import { restRequestBodySchema, runRequestSchema } from "@testate/shared";
import * as v from "valibot";

import { ok, okPage, param, parseBody, parseQuery } from "../../lib/http/index.ts";
import type { Handler } from "../../lib/http/index.ts";
import { firstQuery } from "../../lib/http/query.ts";
import type { RestRequestInput, RestService, RunContext } from "./rest.service.ts";

export type RestHandlers = {
  list: Handler;
  create: Handler;
  get: Handler;
  update: Handler;
  remove: Handler;
  run: Handler;
  runs: Handler;
  runDetail: Handler;
};

const limitQuery = v.object({
  limit: v.optional(
    v.array(v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(1), v.maxValue(50)))
  ),
});

function toInput(body: v.InferOutput<typeof restRequestBodySchema>): RestRequestInput {
  return {
    name: body.name,
    method: body.method,
    path: body.path,
    query: body.query,
    headers: body.headers,
    secrets: body.secrets,
    body: body.body ?? null,
    expected_status: body.expected_status ?? null,
  };
}

/** Drops undefined fields so the patch matches exactOptionalPropertyTypes. */
function toPatch(
  body: v.InferOutput<ReturnType<typeof v.partial<typeof restRequestBodySchema>>>
): Partial<RestRequestInput> {
  const patch: Partial<RestRequestInput> = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.method !== undefined) patch.method = body.method;
  if (body.path !== undefined) patch.path = body.path;
  if (body.query !== undefined) patch.query = body.query;
  if (body.headers !== undefined) patch.headers = body.headers;
  if (body.secrets !== undefined) patch.secrets = body.secrets;
  if (body.body !== undefined) patch.body = body.body;
  if (body.expected_status !== undefined) patch.expected_status = body.expected_status;
  return patch;
}

function toContext(body: v.InferOutput<typeof runRequestSchema>): RunContext {
  const placeholders: RunContext["placeholders"] = {};
  if (body.placeholders?.state !== undefined) placeholders.state = body.placeholders.state;
  if (body.placeholders?.job !== undefined) placeholders.job = body.placeholders.job;
  return { placeholders };
}

export function createRestHandlers(service: RestService): RestHandlers {
  const ids = (c: Parameters<Handler>[0]): [string, string] => [param(c, "slug"), param(c, "id")];
  return {
    list: async (c) => okPage(c, await service.list(...ids(c)), null, 50),
    create: async (c) => {
      const body = await parseBody(c, restRequestBodySchema);
      return ok(c, await service.create(...ids(c), toInput(body)), 201);
    },
    get: async (c) => ok(c, await service.get(...ids(c), param(c, "rid"))),
    update: async (c) => {
      const body = await parseBody(c, v.partial(restRequestBodySchema));
      return ok(c, await service.update(...ids(c), param(c, "rid"), toPatch(body)));
    },
    remove: async (c) => {
      await service.remove(...ids(c), param(c, "rid"));
      return c.body(null, 204);
    },
    run: async (c) => {
      const body = await parseBody(c, runRequestSchema);
      return ok(c, await service.run(...ids(c), param(c, "rid"), toContext(body)));
    },
    runs: async (c) => {
      const limit = firstQuery(parseQuery(c, limitQuery).limit) ?? 50;
      return okPage(c, await service.runs(...ids(c), param(c, "rid"), limit), null, limit);
    },
    runDetail: async (c) =>
      ok(c, await service.runDetail(...ids(c), param(c, "rid"), param(c, "run_id"))),
  };
}

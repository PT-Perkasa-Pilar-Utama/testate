import { restRequestBodySchema, runRequestSchema } from "@testate/shared";
import * as v from "valibot";

import { ok, okPage, param, parseBody } from "../../lib/http/index.ts";
import type { Handler } from "../../lib/http/index.ts";
import type { RestService } from "./rest.service.ts";

export type RestHandlers = {
  list: Handler;
  create: Handler;
  get: Handler;
  update: Handler;
  remove: Handler;
  run: Handler;
  runs: Handler;
};

export function createRestHandlers(service: RestService): RestHandlers {
  return {
    list: async (c) => okPage(c, await service.list(param(c, "id")), null, 50),
    create: async (c) => {
      const body = await parseBody(c, restRequestBodySchema);
      return ok(c, await service.create(param(c, "id"), body.name, body.path), 201);
    },
    get: async (c) => ok(c, await service.get(param(c, "id"), param(c, "rid"))),
    update: async (c) => {
      await parseBody(c, v.partial(restRequestBodySchema));
      return ok(c, await service.update(param(c, "id"), param(c, "rid")));
    },
    remove: async (c) => {
      await service.remove(param(c, "id"), param(c, "rid"), false);
      return c.body(null, 204);
    },
    run: async (c) => {
      await parseBody(c, runRequestSchema);
      return ok(c, await service.run(param(c, "id"), param(c, "rid")));
    },
    runs: async (c) => okPage(c, await service.runs(param(c, "id"), param(c, "rid")), null, 50),
  };
}

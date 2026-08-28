import { hashRequestSchema, randomRequestSchema, uuidRequestSchema } from "@testate/shared";

import { ok, parseBody } from "../../lib/http/index.ts";
import type { Handler } from "../../lib/http/index.ts";
import type { ToolsService } from "./tools.service.ts";

export type ToolsHandlers = { hash: Handler; random: Handler; uuid: Handler };

export function createToolsHandlers(service: ToolsService): ToolsHandlers {
  return {
    hash: async (c) => {
      const body = await parseBody(c, hashRequestSchema);
      const input: Parameters<ToolsService["hash"]>[0] = { algorithm: body.algorithm, value: body.value };
      if (body.secret !== undefined) input.secret = body.secret;
      if (body.salt !== undefined) input.salt = body.salt;
      if (body.cost !== undefined) input.cost = body.cost;
      if (body.memory_mib !== undefined) input.memoryMib = body.memory_mib;
      return ok(c, { algorithm: body.algorithm, hash: await service.hash(input) });
    },
    random: async (c) => {
      const body = await parseBody(c, randomRequestSchema);
      return ok(c, { value: service.random(body.bytes, body.encoding), bytes: body.bytes, encoding: body.encoding });
    },
    uuid: async (c) => {
      const body = await parseBody(c, uuidRequestSchema);
      return ok(c, { values: service.uuid(body.version, body.count) });
    },
  };
}

import { acceptHostKeySchema } from "@testate/shared";
import * as v from "valibot";

import { ok, okPage, param, parseBody, parseQuery } from "../../lib/http/index.ts";
import type { Handler } from "../../lib/http/index.ts";
import type { StorageService } from "./storage.service.ts";

export type StorageHandlers = {
  list: Handler;
  stat: Handler;
  preview: Handler;
  download: Handler;
  acceptHostKey: Handler;
};

const pathQuery = v.object({
  path: v.optional(v.array(v.string())),
  q: v.optional(v.array(v.string())),
});
const requiredPathQuery = v.object({ path: v.pipe(v.array(v.string()), v.minLength(1)) });

export function createStorageHandlers(service: StorageService): StorageHandlers {
  return {
    list: async (c) => {
      const query = parseQuery(c, pathQuery);
      return okPage(
        c,
        await service.list(param(c, "id"), query.path?.[0], query.q?.[0]),
        null,
        200
      );
    },
    stat: async (c) => {
      const query = parseQuery(c, requiredPathQuery);
      return ok(c, await service.stat(param(c, "id"), query.path[0] ?? ""));
    },
    preview: async (c) => {
      const query = parseQuery(c, requiredPathQuery);
      return ok(c, await service.preview(param(c, "id"), query.path[0] ?? ""));
    },
    download: async (c) => {
      const query = parseQuery(c, requiredPathQuery);
      const path = query.path[0] ?? "";
      const file = await service.download(param(c, "id"), path);
      c.header("Content-Type", file.contentType);
      c.header("Content-Disposition", `attachment; filename="${path.split("/").pop() ?? "file"}"`);
      return c.body(file.body, 200);
    },
    acceptHostKey: async (c) => {
      const body = await parseBody(c, acceptHostKeySchema);
      await service.acceptHostKey(param(c, "id"), body.fingerprint);
      return c.body(null, 204);
    },
  };
}

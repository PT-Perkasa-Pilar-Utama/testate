import { acceptHostKeySchema } from "@testate/shared";
import * as v from "valibot";

import { currentActor, requestMeta } from "../../lib/http/auth.ts";
import { firstQuery, ok, okPage, param, parseBody, parseQuery } from "../../lib/http/index.ts";
import type { Handler } from "../../lib/http/index.ts";
import type { EntriesQuery, StorageService } from "./storage.service.ts";

export type StorageHandlers = {
  list: Handler;
  stat: Handler;
  preview: Handler;
  download: Handler;
  acceptHostKey: Handler;
};

const entriesQuery = v.object({
  path: v.optional(v.array(v.string())),
  cursor: v.optional(v.array(v.string())),
  limit: v.optional(v.array(v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(1)))),
  q: v.optional(v.array(v.string())),
});
const requiredPathQuery = v.object({ path: v.pipe(v.array(v.string()), v.minLength(1)) });

function toQuery(parsed: v.InferOutput<typeof entriesQuery>): EntriesQuery {
  const query: EntriesQuery = {};
  const path = firstQuery(parsed.path);
  const cursor = firstQuery(parsed.cursor);
  const limit = firstQuery(parsed.limit);
  const q = firstQuery(parsed.q);
  if (path !== undefined) query.path = path;
  if (cursor !== undefined) query.cursor = cursor;
  if (limit !== undefined) query.limit = limit;
  if (q !== undefined) query.q = q;
  return query;
}

/** RFC 6266 filename: ASCII fallback without quotes or control characters, plus the UTF-8 form. */
export function contentDisposition(kind: "inline" | "attachment", name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "file";
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export function createStorageHandlers(
  service: StorageService,
  trustProxy: boolean
): StorageHandlers {
  const args = (c: Parameters<Handler>[0]): [ReturnType<typeof currentActor>, string, string] => [
    currentActor(c),
    param(c, "slug"),
    param(c, "id"),
  ];
  return {
    list: async (c) => {
      const page = await service.list(...args(c), toQuery(parseQuery(c, entriesQuery)));
      return okPage(c, page.data, page.next_cursor, 200);
    },
    stat: async (c) => {
      const query = parseQuery(c, requiredPathQuery);
      return ok(c, await service.stat(...args(c), query.path[0] ?? ""));
    },
    preview: async (c) => {
      const query = parseQuery(c, requiredPathQuery);
      const path = query.path[0] ?? "";
      const result = await service.preview(...args(c), path);
      if (result.kind === "payload") return ok(c, result.payload);
      c.header("Content-Type", result.contentType);
      c.header(
        "Content-Disposition",
        contentDisposition("inline", path.split("/").pop() ?? "file")
      );
      c.header("X-Content-Type-Options", "nosniff");
      c.header("Content-Security-Policy", "sandbox; default-src 'none'");
      return c.body(new Blob([result.bytes]).stream(), 200);
    },
    download: async (c) => {
      const query = parseQuery(c, requiredPathQuery);
      const file = await service.download(...args(c), query.path[0] ?? "");
      c.header("Content-Type", "application/octet-stream");
      c.header("Content-Disposition", contentDisposition("attachment", file.name));
      c.header("X-Content-Type-Options", "nosniff");
      if (file.size !== null) c.header("Content-Length", String(file.size));
      return c.body(file.stream, 200);
    },
    acceptHostKey: async (c) => {
      const body = await parseBody(c, acceptHostKeySchema);
      await service.acceptHostKey(...args(c), body.fingerprint, requestMeta(c, trustProxy));
      return c.body(null, 204);
    },
  };
}

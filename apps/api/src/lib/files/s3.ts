import { S3Client } from "bun";
import type { Entry } from "@testate/shared";
import * as v from "valibot";

import { byName, missing, nameOf, normalizePath, notAFile, unreachable } from "./index.ts";
import type { FileSource, ListPage } from "./index.ts";

export type S3SourceConfig = {
  bucket: string;
  prefix: string;
  region: string;
  endpoint?: string;
  virtual_hosted: boolean;
  accessKeyId: string;
  secretAccessKey: string;
};

const s3Error = v.object({ code: v.optional(v.string()) });

function codeOf(cause: unknown): string | undefined {
  return v.is(s3Error, cause) ? cause.code : undefined;
}

function failure(cause: unknown, path: string): Error {
  const code = codeOf(cause);
  return code === "NoSuchKey" || code === "NotFound" ? missing(path) : unreachable(cause, code);
}

function keyOf(prefix: string, path: string): string {
  const base = prefix.replace(/^\/+|\/+$/g, "");
  if (base === "") return path;
  return path === "" ? base : `${base}/${path}`;
}

/** S3 and compatible stores through `Bun.S3Client` (10 §10.3); `/`-delimited keys are the tree. */
export function createS3Source(config: S3SourceConfig): FileSource {
  const options: ConstructorParameters<typeof S3Client>[0] = {
    bucket: config.bucket,
    region: config.region,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    virtualHostedStyle: config.virtual_hosted,
  };
  if (config.endpoint !== undefined) options.endpoint = config.endpoint;
  const client = new S3Client(options);
  const dirPrefix = (dir: string): string => {
    const key = keyOf(config.prefix, dir);
    return key === "" ? "" : `${key}/`;
  };
  const relative = (key: string): string => {
    const base = keyOf(config.prefix, "");
    return base === "" ? key : key.slice(base.length + 1);
  };
  const listDir = async (
    dir: string,
    limit: number,
    cursor: string | undefined
  ): Promise<ListPage> => {
    const input: Parameters<S3Client["list"]>[0] = {
      prefix: dirPrefix(dir),
      delimiter: "/",
      maxKeys: limit,
    };
    if (cursor !== undefined) input.continuationToken = cursor;
    const response = await client.list(input);
    const directories: Entry[] = (response.commonPrefixes ?? []).map((item) => {
      const path = relative(item.prefix.replace(/\/$/, ""));
      return { name: nameOf(path), path, kind: "directory", size_bytes: null, modified_at: null };
    });
    const files: Entry[] = (response.contents ?? [])
      .filter((item) => !item.key.endsWith("/"))
      .map((item) => {
        const path = relative(item.key);
        return {
          name: nameOf(path),
          path,
          kind: "file",
          size_bytes: item.size ?? null,
          modified_at:
            item.lastModified === undefined ? null : new Date(item.lastModified).toISOString(),
        };
      });
    return {
      data: [...directories, ...files].sort(byName),
      next_cursor: response.isTruncated === true ? (response.nextContinuationToken ?? null) : null,
    };
  };
  const statEntry = async (path: string): Promise<Entry> => {
    const clean = normalizePath(path);
    try {
      const info = await client.stat(keyOf(config.prefix, clean));
      return {
        name: nameOf(clean),
        path: clean,
        kind: "file",
        size_bytes: info.size,
        modified_at: info.lastModified.toISOString(),
      };
    } catch (cause: unknown) {
      const code = codeOf(cause);
      if (code !== "NoSuchKey" && code !== "NotFound") throw unreachable(cause, code);
    }
    const page = await listDir(clean, 1, undefined).catch((cause: unknown) => {
      throw failure(cause, clean);
    });
    if (page.data.length === 0) throw missing(clean);
    return {
      name: nameOf(clean),
      path: clean,
      kind: "directory",
      size_bytes: null,
      modified_at: null,
    };
  };
  return {
    async list(path, query) {
      const dir = normalizePath(path);
      try {
        const page = await listDir(dir, query.limit, query.cursor);
        if (dir !== "" && page.data.length === 0 && query.cursor === undefined) throw missing(dir);
        // ponytail: `q` filters within the fetched page only; S3 has no server-side name search.
        if (query.q !== undefined)
          page.data = page.data.filter((e) => e.name.includes(query.q ?? ""));
        return page;
      } catch (cause: unknown) {
        throw failure(cause, dir);
      }
    },
    stat: statEntry,
    async read(path) {
      const clean = normalizePath(path);
      const file = client.file(keyOf(config.prefix, clean));
      if (!(await file.exists().catch((cause: unknown) => Promise.reject(failure(cause, clean)))))
        throw missing(clean);
      return file.stream();
    },
    async put(path, body) {
      const clean = normalizePath(path);
      // A key ending in `/` is how this store spells a directory, and there are no others to make.
      if (clean === "") throw notAFile(clean);
      try {
        await client.write(keyOf(config.prefix, clean), body);
      } catch (cause: unknown) {
        throw failure(cause, clean);
      }
    },
    async remove(path) {
      const clean = normalizePath(path);
      // Through `stat`, not a plain existence check, for two reasons. S3 deletes a key that was
      // never there without complaining, which would let a typo look like a success; and a key
      // that is only a prefix is a directory here, which the port refuses rather than empties.
      if ((await statEntry(clean)).kind !== "file") throw notAFile(clean);
      await client
        .file(keyOf(config.prefix, clean))
        .delete()
        .catch((cause: unknown) => Promise.reject(failure(cause, clean)));
    },
    async close() {},
  };
}

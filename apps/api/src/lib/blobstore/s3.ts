import { S3Client } from "bun";
import * as v from "valibot";

import { assertHash, collectHashed } from "./index.ts";
import type { BlobStore } from "./index.ts";

export type S3StoreConfig = {
  bucket: string;
  prefix: string;
  region: string | null;
  endpoint: string | null;
  virtual_hosted: boolean;
  access_key_id: string;
  secret_access_key: string;
};

const RETRIES = 3;
const RETRY_CODES = new Set(["InternalError", "SlowDown", "ServiceUnavailable", "RequestTimeout"]);
const s3Error = v.object({ code: v.optional(v.string()), status: v.optional(v.number()) });

function retriable(cause: unknown): boolean {
  if (!v.is(s3Error, cause)) return false;
  return (cause.status !== undefined && cause.status >= 500) || RETRY_CODES.has(cause.code ?? "");
}

/** Three attempts with exponential backoff on 5xx and throttling (15 §15.6). */
async function withRetry<T>(
  run: () => Promise<T>,
  sleep: (ms: number) => Promise<void>
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await run();
    } catch (cause: unknown) {
      attempt += 1;
      if (attempt >= RETRIES || !retriable(cause)) throw cause;
      await sleep(100 * 2 ** attempt);
    }
  }
}

function keyOf(prefix: string, hash: string): string {
  const base = prefix.replace(/^\/+|\/+$/g, "");
  return `${base === "" ? "" : `${base}/`}blobs/${hash.slice(0, 2)}/${hash}`;
}

/** Same layout as the local store under `<prefix>/blobs/`; a put is verified by a HEAD on the size. */
export function createS3BlobStore(
  config: S3StoreConfig,
  sleep: (ms: number) => Promise<void> = (ms) => Bun.sleep(ms)
): BlobStore {
  const options: ConstructorParameters<typeof S3Client>[0] = {
    bucket: config.bucket,
    accessKeyId: config.access_key_id,
    secretAccessKey: config.secret_access_key,
    virtualHostedStyle: config.virtual_hosted,
  };
  if (config.region !== null) options.region = config.region;
  if (config.endpoint !== null) options.endpoint = config.endpoint;
  const client = new S3Client(options);
  const listPrefix = keyOf(config.prefix, "").replace(/\/+$/, "/");
  const sizeOf = async (hash: string): Promise<number | null> => {
    if (!(await client.exists(keyOf(config.prefix, hash)))) return null;
    return (await client.stat(keyOf(config.prefix, hash))).size;
  };
  return {
    async put(stream, opts) {
      const { hash, size, bytes } = await collectHashed(stream);
      assertHash(opts.expectedHash, hash);
      const existing = await withRetry(() => sizeOf(hash), sleep);
      if (existing === size) return { hash, size, existed: true };
      await withRetry(() => client.write(keyOf(config.prefix, hash), Buffer.concat(bytes)), sleep);
      const stored = await withRetry(() => sizeOf(hash), sleep);
      if (stored !== size)
        throw new Error(`s3 put of ${hash} stored ${stored ?? "nothing"} of ${size} bytes`);
      return { hash, size, existed: false };
    },
    get: (hash) => client.file(keyOf(config.prefix, hash)).stream(),
    has: (hash) => withRetry(() => client.exists(keyOf(config.prefix, hash)), sleep),
    async stat(hash) {
      const size = await withRetry(() => sizeOf(hash), sleep);
      return size === null ? null : { size };
    },
    delete: (hash) => withRetry(() => client.unlink(keyOf(config.prefix, hash)), sleep),
    async *list() {
      let token: string | undefined;
      do {
        const input: Parameters<S3Client["list"]>[0] = { prefix: listPrefix, maxKeys: 1000 };
        if (token !== undefined) input.continuationToken = token;
        const page = await withRetry(() => client.list(input), sleep);
        for (const item of page.contents ?? []) {
          const hash = item.key.slice(item.key.lastIndexOf("/") + 1);
          if (/^[0-9a-f]{64}$/.test(hash)) yield { hash, size: item.size ?? 0 };
        }
        token = page.isTruncated === true ? page.nextContinuationToken : undefined;
      } while (token !== undefined);
    },
  };
}

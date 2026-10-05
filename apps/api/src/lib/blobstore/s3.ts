import { S3Client } from "bun";
import * as v from "valibot";

import { AppError } from "../http/index.ts";
import { pinHttpEndpoint } from "../netguard/index.ts";
import type { Check, Verdict } from "../netguard/index.ts";
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

export type StoreAddressCheck = (input: Check) => Promise<Verdict>;

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
  sleep: (ms: number) => Promise<void> = (ms) => Bun.sleep(ms),
  check?: StoreAddressCheck
): BlobStore {
  const baseOptions: ConstructorParameters<typeof S3Client>[0] = {
    bucket: config.bucket,
    accessKeyId: config.access_key_id,
    secretAccessKey: config.secret_access_key,
    virtualHostedStyle: config.virtual_hosted,
  };
  if (config.region !== null) baseOptions.region = config.region;
  if (config.endpoint !== null) baseOptions.endpoint = config.endpoint;
  const target =
    config.endpoint === null
      ? {
          host: config.region === null ? "s3.amazonaws.com" : `s3.${config.region}.amazonaws.com`,
          port: 443,
        }
      : (() => {
          const url = new URL(config.endpoint);
          return {
            host: url.hostname,
            port: url.port === "" ? (url.protocol === "http:" ? 80 : 443) : Number(url.port),
          };
        })();
  const clients = new Map<string, S3Client>();
  const clientOf = async (): Promise<S3Client> => {
    if (check === undefined) {
      const key = "default";
      const existing = clients.get(key);
      if (existing !== undefined) return existing;
      const client = new S3Client(baseOptions);
      clients.set(key, client);
      return client;
    }
    const verdict = await check({ ...target, purpose: "store" });
    if (!verdict.allowed) {
      const code = verdict.reason === "unresolvable" ? "ADAPTER_UNREACHABLE" : "HOST_BLOCKED";
      throw new AppError(code, "the snapshot store target is blocked by outbound policy", {
        reason: verdict.reason,
        matched: verdict.matched,
      });
    }
    const address = verdict.addresses[0];
    if (address === undefined) {
      throw new AppError("ADAPTER_UNREACHABLE", "the snapshot store target has no usable address", {
        reason: "unresolvable",
        matched: target.host,
      });
    }
    // Bun derives AWS endpoints from the region and does not expose a socket-address override;
    // explicit compatible endpoints are pinned below, while AWS keeps its TLS/virtual-host shape.
    const key = config.endpoint === null ? "aws" : `${address}:${target.port}`;
    const existing = clients.get(key);
    if (existing !== undefined) return existing;
    const endpoint =
      config.endpoint === null ? null : pinHttpEndpoint(config.endpoint, address, target.port);
    const options: ConstructorParameters<typeof S3Client>[0] = { ...baseOptions };
    if (endpoint !== null && endpoint !== config.endpoint) {
      options.endpoint = endpoint;
      options.virtualHostedStyle = false;
    }
    const client = new S3Client(options);
    clients.set(key, client);
    return client;
  };
  const listPrefix = keyOf(config.prefix, "").replace(/\/+$/, "/");
  const sizeOf = async (client: S3Client, hash: string): Promise<number | null> => {
    if (!(await client.exists(keyOf(config.prefix, hash)))) return null;
    return (await client.stat(keyOf(config.prefix, hash))).size;
  };
  return {
    async put(stream, opts) {
      const { hash, size, bytes } = await collectHashed(stream);
      assertHash(opts.expectedHash, hash);
      const existing = await withRetry(async () => sizeOf(await clientOf(), hash), sleep);
      if (existing === size) return { hash, size, existed: true };
      await withRetry(
        async () => (await clientOf()).write(keyOf(config.prefix, hash), Buffer.concat(bytes)),
        sleep
      );
      const stored = await withRetry(async () => sizeOf(await clientOf(), hash), sleep);
      if (stored !== size)
        throw new Error(`s3 put of ${hash} stored ${stored ?? "nothing"} of ${size} bytes`);
      return { hash, size, existed: false };
    },
    get: (hash) => {
      type ByteChunk = Uint8Array<ArrayBuffer>;
      type ByteReader = {
        read(): Promise<{ done: boolean; value?: ByteChunk | undefined }>;
        cancel(): Promise<void>;
      };
      let reader: ByteReader | null = null;
      return new ReadableStream({
        async pull(controller) {
          try {
            reader ??= (await clientOf()).file(keyOf(config.prefix, hash)).stream().getReader();
            const next = await reader.read();
            if (next.done) controller.close();
            else controller.enqueue(next.value);
          } catch (cause: unknown) {
            controller.error(cause);
          }
        },
        async cancel() {
          await reader?.cancel();
        },
      });
    },
    has: (hash) =>
      withRetry(async () => (await clientOf()).exists(keyOf(config.prefix, hash)), sleep),
    async stat(hash) {
      const size = await withRetry(async () => sizeOf(await clientOf(), hash), sleep);
      return size === null ? null : { size };
    },
    delete: (hash) =>
      withRetry(async () => (await clientOf()).unlink(keyOf(config.prefix, hash)), sleep),
    async *list() {
      let token: string | undefined;
      do {
        const input: Parameters<S3Client["list"]>[0] = { prefix: listPrefix, maxKeys: 1000 };
        if (token !== undefined) input.continuationToken = token;
        const page = await withRetry(async () => (await clientOf()).list(input), sleep);
        for (const item of page.contents ?? []) {
          const hash = item.key.slice(item.key.lastIndexOf("/") + 1);
          if (/^[0-9a-f]{64}$/.test(hash)) yield { hash, size: item.size ?? 0 };
        }
        token = page.isTruncated === true ? page.nextContinuationToken : undefined;
      } while (token !== undefined);
    },
  };
}

/** Sync hashing for `Bun.CryptoHasher` and `createHash`: WebCrypto is async only. */
import { hmac } from "@noble/hashes/hmac.js";
import { md5, sha1 } from "@noble/hashes/legacy.js";
import { sha224, sha256, sha384, sha512 } from "@noble/hashes/sha2.js";

import { bytesOf } from "./memfs.ts";

const ALGORITHMS = new Map([
  ["sha1", sha1],
  ["md5", md5],
  ["sha224", sha224],
  ["sha256", sha256],
  ["sha384", sha384],
  ["sha512", sha512],
]);

export type Incremental = { update: (data: Uint8Array) => Incremental; digest: () => Uint8Array };

export function hasher(algorithm: string, key?: string | Uint8Array): Incremental {
  const hash = ALGORITHMS.get(algorithm.toLowerCase().replace("-", ""));
  if (hash === undefined) throw new Error(`${algorithm} is not available in the demo`);
  return key === undefined ? hash.create() : hmac.create(hash, bytesOf(key));
}

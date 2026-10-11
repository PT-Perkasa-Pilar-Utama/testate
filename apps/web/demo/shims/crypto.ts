/** `node:crypto` `createHash`, over @noble/hashes, for the log parsers. */
import { hasher } from "./hash.ts";
import { bytesOf } from "./memfs.ts";

type Encoding = "hex" | "base64";
type Hash = {
  update: (data: string | Uint8Array) => Hash;
  digest: (encoding?: Encoding) => string;
};

export function encode(bytes: Uint8Array, encoding: Encoding): string {
  if (encoding === "hex")
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return btoa(String.fromCharCode(...bytes));
}

export function createHash(algorithm: string): Hash {
  const hash = hasher(algorithm);
  const self: Hash = {
    update: (data) => {
      hash.update(bytesOf(data));
      return self;
    },
    digest: (encoding = "hex") => encode(hash.digest(), encoding),
  };
  return self;
}

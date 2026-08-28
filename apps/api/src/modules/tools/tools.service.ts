import { AppError } from "../../lib/http/index.ts";

export type HashAlgorithm = "argon2id" | "bcrypt" | "sha256" | "sha512" | "hmac_sha256";
export type Encoding = "hex" | "base64" | "base64url";

export type ToolsService = {
  hash(input: { algorithm: HashAlgorithm; value: string; secret?: string; salt?: string; cost?: number; memoryMib?: number }): Promise<string>;
  random(bytes: number, encoding: Encoding): string;
  uuid(version: 4 | 7, count: number): string[];
};

function encode(bytes: Uint8Array<ArrayBuffer>, encoding: Encoding): string {
  if (encoding === "hex") return bytes.toHex();
  return bytes.toBase64({ alphabet: encoding === "base64url" ? "base64url" : "base64", omitPadding: encoding === "base64url" });
}

/** Real implementation: the same primitives the form functions and import transforms use. */
export function createToolsService(): ToolsService {
  return {
    async hash(input) {
      switch (input.algorithm) {
        case "bcrypt":
          return Bun.password.hash(input.value, { algorithm: "bcrypt", cost: input.cost ?? 12 });
        case "argon2id":
          return Bun.password.hash(input.value, { algorithm: "argon2id", memoryCost: (input.memoryMib ?? 64) * 1024 });
        case "sha256":
        case "sha512":
          return new Bun.CryptoHasher(input.algorithm).update(`${input.salt ?? ""}${input.value}`).digest("hex");
        case "hmac_sha256": {
          if (input.secret === undefined) throw new AppError("VALIDATION_ERROR", "hmac needs a secret");
          return new Bun.CryptoHasher("sha256", input.secret).update(input.value).digest("hex");
        }
      }
    },
    random(bytes, encoding) {
      return encode(crypto.getRandomValues(new Uint8Array(bytes)), encoding);
    },
    uuid(version, count) {
      return Array.from({ length: count }, () => (version === 7 ? Bun.randomUUIDv7() : crypto.randomUUID()));
    },
  };
}

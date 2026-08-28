import * as v from "valibot";

export const hashRequestSchema = v.pipe(
  v.object({
    algorithm: v.picklist(["argon2id", "bcrypt", "sha256", "sha512", "hmac_sha256"]),
    value: v.pipe(v.string(), v.maxLength(4096)),
    secret: v.optional(v.pipe(v.string(), v.maxLength(4096))),
    salt: v.optional(v.pipe(v.string(), v.maxLength(256))),
    cost: v.optional(v.pipe(v.number(), v.integer(), v.minValue(4), v.maxValue(14))),
    memory_mib: v.optional(v.pipe(v.number(), v.integer(), v.minValue(16), v.maxValue(128))),
  }),
  v.check(
    (input) => input.algorithm !== "hmac_sha256" || input.secret !== undefined,
    "hmac needs a secret"
  )
);

export const hashResponseSchema = v.object({
  algorithm: v.picklist(["argon2id", "bcrypt", "sha256", "sha512", "hmac_sha256"]),
  hash: v.string(),
});

export const randomRequestSchema = v.object({
  bytes: v.optional(v.pipe(v.number(), v.integer(), v.minValue(8), v.maxValue(1024)), 32),
  encoding: v.optional(v.picklist(["hex", "base64", "base64url"]), "base64url"),
});

export const randomResponseSchema = v.object({
  value: v.string(),
  bytes: v.number(),
  encoding: v.picklist(["hex", "base64", "base64url"]),
});

export const uuidRequestSchema = v.object({
  version: v.optional(v.picklist([4, 7]), 7),
  count: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100)), 1),
});

export const uuidResponseSchema = v.object({
  values: v.array(v.pipe(v.string(), v.uuid())),
});

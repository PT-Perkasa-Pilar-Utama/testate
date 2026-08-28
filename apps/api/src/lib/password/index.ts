export type PasswordHasher = {
  hash(plain: string): Promise<string>;
  verify(plain: string, hash: string): Promise<boolean>;
};

export type Argon2Options = { memoryCost: number; timeCost: number };

/** argon2id, Bun defaults (64 MiB, 2 iterations) per 09 §9.6. Tests pass cheaper costs. */
export function createPasswordHasher(
  options: Argon2Options = { memoryCost: 65536, timeCost: 2 }
): PasswordHasher {
  return {
    hash: (plain) => Bun.password.hash(plain, { algorithm: "argon2id", ...options }),
    verify: (plain, hash) => Bun.password.verify(plain, hash),
  };
}

/** Hex SHA-256, the stored form of session cookies and API tokens (06 §6.3). */
export function sha256(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

/** 32 random bytes as base64url: 43 characters, no padding. */
export function randomSecret(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

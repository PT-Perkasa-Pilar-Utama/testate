const KEY_BYTES = 32;
const MAX_KEYS = 5;

export class SealedConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SealedConfigError";
  }
}

export type KeyRing = {
  activeKid: string;
  active: CryptoKey;
  all: ReadonlyMap<string, CryptoKey>;
};

function decodeKey(value: string, position: number): Uint8Array<ArrayBuffer> {
  if (value.length === 0)
    throw new SealedConfigError(`value ${position} in TESTATE_SECRETS_ACTIVE_KEY is empty`);
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = Uint8Array.fromBase64(value);
  } catch {
    throw new SealedConfigError(
      `value ${position} in TESTATE_SECRETS_ACTIVE_KEY is not valid base64`
    );
  }
  if (bytes.byteLength !== KEY_BYTES) {
    throw new SealedConfigError(
      `value ${position} in TESTATE_SECRETS_ACTIVE_KEY is ${bytes.byteLength} bytes (need ${KEY_BYTES})`
    );
  }
  return bytes;
}

/** The key id is the first eight hex characters of SHA-256 over the raw key bytes. */
export function kidOf(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex").slice(0, 8);
}

/** Parses `<new>,<old>` into a ring: the first key seals, every key opens. Refuses loudly. */
export async function loadKeyRing(raw: string): Promise<KeyRing> {
  const values = raw.split(",").map((value) => value.trim());
  if (values.length > MAX_KEYS) {
    throw new SealedConfigError(
      `TESTATE_SECRETS_ACTIVE_KEY holds ${values.length} values; at most ${MAX_KEYS}`
    );
  }
  const entries: { kid: string; key: CryptoKey }[] = [];
  const seen = new Map<string, number>();
  for (const [index, value] of values.entries()) {
    const bytes = decodeKey(value, index + 1);
    const kid = kidOf(bytes);
    const earlier = seen.get(kid);
    if (earlier !== undefined) {
      throw new SealedConfigError(
        `values ${earlier} and ${index + 1} in TESTATE_SECRETS_ACTIVE_KEY are the same key`
      );
    }
    seen.set(kid, index + 1);
    const key = await crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, [
      "encrypt",
      "decrypt",
    ]);
    entries.push({ kid, key });
  }
  const first = entries[0];
  if (first === undefined) throw new SealedConfigError("TESTATE_SECRETS_ACTIVE_KEY is not set");
  return {
    activeKid: first.kid,
    active: first.key,
    all: new Map(entries.map((entry) => [entry.kid, entry.key])),
  };
}

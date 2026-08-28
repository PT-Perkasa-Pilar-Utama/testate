import type { KeyRing } from "./keyring.ts";

export { SealedConfigError, kidOf, loadKeyRing } from "./keyring.ts";
export type { KeyRing } from "./keyring.ts";

const VERSION = "v1";
const NONCE_BYTES = 12;

/** A sealed envelope: `v1.<kid>.<nonce>.<ciphertext+tag>`, base64url segments. */
export type Sealed = string & { readonly __sealed: unique symbol };

export class UnreadableError extends Error {
  readonly kid: string;

  constructor(kid: string) {
    super(`sealed value was sealed by key ${kid}, which is not configured`);
    this.name = "UnreadableError";
    this.kid = kid;
  }
}

function brand(value: string): Sealed {
  // SAFETY: the only constructor of the branded envelope string; every caller built the four segments above.
  return value as Sealed;
}

function encode(bytes: Uint8Array<ArrayBuffer>): string {
  return bytes.toBase64({ alphabet: "base64url", omitPadding: true });
}

function decode(segment: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.fromBase64(segment, { alphabet: "base64url" });
}

/** Seals `plaintext` under the active key, binding `aad` (table:column:row) so a ciphertext cannot move. */
export async function seal(ring: KeyRing, plaintext: string, aad: string): Promise<Sealed> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: new TextEncoder().encode(aad) },
    ring.active,
    new TextEncoder().encode(plaintext)
  );
  return brand(
    `${VERSION}.${ring.activeKid}.${encode(nonce)}.${encode(new Uint8Array(ciphertext))}`
  );
}

/** Which key sealed this value. */
export function kidOfSealed(sealed: Sealed): string {
  const kid = sealed.split(".")[1];
  if (kid === undefined) throw new Error("malformed sealed value");
  return kid;
}

/** Opens a sealed value with any key in the ring; throws UnreadableError when none matches. */
export async function open(ring: KeyRing, sealed: Sealed, aad: string): Promise<string> {
  const [version, kid, nonce, payload] = sealed.split(".");
  if (version !== VERSION || kid === undefined || nonce === undefined || payload === undefined) {
    throw new Error("malformed sealed value");
  }
  const key = ring.all.get(kid);
  if (key === undefined) throw new UnreadableError(kid);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decode(nonce), additionalData: new TextEncoder().encode(aad) },
    key,
    decode(payload)
  );
  return new TextDecoder().decode(plaintext);
}

/** Re-seals under the active key when another key sealed the value; returns null when unchanged. */
export async function reseal(ring: KeyRing, sealed: Sealed, aad: string): Promise<Sealed | null> {
  if (kidOfSealed(sealed) === ring.activeKid) return null;
  return seal(ring, await open(ring, sealed, aad), aad);
}

export function isSealed(value: string): value is Sealed {
  return /^v1\.[0-9a-f]{8}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
}

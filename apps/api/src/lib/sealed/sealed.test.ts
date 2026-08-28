import { describe, expect, it } from "bun:test";

import {
  SealedConfigError,
  UnreadableError,
  isSealed,
  kidOfSealed,
  loadKeyRing,
  open,
  reseal,
  seal,
} from "./index.ts";

const KEY_A = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";
const KEY_B = "Hx4dHBsaGRgXFhUUExIREA8ODQwLCgkIBwYFBAMCAQA=";

function required<T>(value: T | null): T {
  if (value === null) throw new Error("expected a value");
  return value;
}

describe("loadKeyRing", () => {
  it("refuses an empty list", async () => {
    await expect(loadKeyRing("")).rejects.toThrow("is empty");
  });

  it("refuses a key that is not 32 bytes", async () => {
    await expect(loadKeyRing("c2hvcnQ=")).rejects.toThrow("bytes (need 32)");
  });

  it("refuses the same key twice", async () => {
    await expect(loadKeyRing(`${KEY_A},${KEY_A}`)).rejects.toThrow("are the same key");
  });

  it("refuses more than five keys", async () => {
    const six = Array.from({ length: 6 }, () => KEY_A).join(",");
    await expect(loadKeyRing(six)).rejects.toBeInstanceOf(SealedConfigError);
  });

  it("makes the first key the active one", async () => {
    const ring = await loadKeyRing(`${KEY_B},${KEY_A}`);
    expect(ring.all.size).toBe(2);
    expect(ring.all.has(ring.activeKid)).toBe(true);
  });
});

describe("seal and open", () => {
  it("round-trips a value under the active key", async () => {
    const ring = await loadKeyRing(KEY_A);
    const sealed = await seal(ring, "hunter2", "adapters:config_sealed:01J");
    expect(isSealed(sealed)).toBe(true);
    expect(kidOfSealed(sealed)).toBe(ring.activeKid);
    expect(await open(ring, sealed, "adapters:config_sealed:01J")).toBe("hunter2");
  });

  it("refuses to open a value moved to another row", async () => {
    const ring = await loadKeyRing(KEY_A);
    const sealed = await seal(ring, "hunter2", "adapters:config_sealed:01J");
    await expect(open(ring, sealed, "adapters:config_sealed:02K")).rejects.toThrow(
      "The operation failed"
    );
  });

  it("opens with the old key and re-seals under the new one during rotation", async () => {
    const before = await loadKeyRing(KEY_A);
    const sealed = await seal(before, "hunter2", "aad");
    const rotated = await loadKeyRing(`${KEY_B},${KEY_A}`);
    const resealed = required(await reseal(rotated, sealed, "aad"));
    expect(kidOfSealed(resealed)).toBe(rotated.activeKid);
    expect(await open(rotated, resealed, "aad")).toBe("hunter2");
  });

  it("names the sealing key when it is not configured", async () => {
    const old = await loadKeyRing(KEY_A);
    const sealed = await seal(old, "hunter2", "aad");
    const replaced = await loadKeyRing(KEY_B);
    await expect(open(replaced, sealed, "aad")).rejects.toBeInstanceOf(UnreadableError);
  });
});

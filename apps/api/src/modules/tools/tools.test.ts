import { describe, expect, it } from "bun:test";

import { createToolsService } from "./tools.service.ts";

describe("tools", () => {
  const service = createToolsService();

  it("produces a bcrypt hash that verifies and a different one each time", async () => {
    const first = await service.hash({ algorithm: "bcrypt", value: "correct-horse", cost: 4 });
    const second = await service.hash({ algorithm: "bcrypt", value: "correct-horse", cost: 4 });
    expect(first).not.toBe(second);
    expect(await Bun.password.verify("correct-horse", first)).toBe(true);
    expect(await Bun.password.verify("wrong", first)).toBe(false);
  });

  it("sha256 is deterministic and salt-sensitive", async () => {
    const plain = await service.hash({ algorithm: "sha256", value: "abc" });
    expect(plain).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(await service.hash({ algorithm: "sha256", value: "abc", salt: "x" })).not.toBe(plain);
  });

  it("hmac needs a secret and changes with it", async () => {
    await expect(service.hash({ algorithm: "hmac_sha256", value: "abc" })).rejects.toThrow("hmac needs a secret");
    const a = await service.hash({ algorithm: "hmac_sha256", value: "abc", secret: "k1" });
    const b = await service.hash({ algorithm: "hmac_sha256", value: "abc", secret: "k2" });
    expect(a).not.toBe(b);
  });

  it("random secrets have the requested size and uuids the requested version", () => {
    expect(service.random(32, "hex")).toHaveLength(64);
    const ids = service.uuid(7, 3);
    expect(ids).toHaveLength(3);
    expect(ids.every((id) => id[14] === "7")).toBe(true);
  });
});

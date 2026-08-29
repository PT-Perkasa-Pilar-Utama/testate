import { describe, expect, it } from "bun:test";

import { check, matchesDenyList, parseDenyList } from "./index.ts";

const SELF = { addresses: ["10.0.0.9"], port: 3000 };
const DEFAULT = parseDenyList(["127.0.0.0/8", "::1/128"]);

describe("deny list parsing and matching", () => {
  it("matches CIDRs, single addresses, host:port pairs, and hostname globs", () => {
    const policy = parseDenyList([
      "10.1.0.0/16",
      "192.168.5.7",
      "db.sit.internal:5432",
      "*.prod.internal",
    ]);
    expect(matchesDenyList("x", ["10.1.4.4"], 1, policy)).toBe("10.1.4.4");
    expect(matchesDenyList("x", ["192.168.5.7"], 1, policy)).toBe("192.168.5.7");
    expect(matchesDenyList("db.sit.internal", ["10.9.9.9"], 5432, policy)).toBe(
      "db.sit.internal:5432"
    );
    expect(matchesDenyList("api.prod.internal", ["10.9.9.9"], 5433, policy)).toBe(
      "^.*\\.prod\\.internal$"
    );
    expect(matchesDenyList("db.sit.internal", ["10.9.9.9"], 5433, policy)).toBeNull();
  });

  it("ignores blank entries and treats globs case-insensitively", () => {
    const policy = parseDenyList(["", " *.PROD.internal "]);
    expect(matchesDenyList("Api.prod.Internal", [], 80, policy)).not.toBeNull();
    expect(policy.raw.length).toBe(2);
  });
});

describe("check", () => {
  it("allows a plain intranet address", async () => {
    expect(
      await check({ host: "10.0.4.7", port: 5432, purpose: "database" }, DEFAULT, SELF)
    ).toStrictEqual({
      allowed: true,
      addresses: ["10.0.4.7"],
    });
  });

  it("refuses the fixed targets whatever the policy says", async () => {
    const empty = parseDenyList([]);
    for (const host of [
      "169.254.169.254",
      "0.0.0.0",
      "224.0.0.1",
      "fe80::1",
      "metadata.google.internal",
    ]) {
      const verdict = await check({ host, port: 80, purpose: "rest" }, empty, SELF);
      expect(verdict).toMatchObject({ allowed: false, reason: "fixed" });
    }
  });

  it("refuses Testate's own address and port only", async () => {
    expect(
      await check({ host: "10.0.0.9", port: 3000, purpose: "rest" }, DEFAULT, SELF)
    ).toMatchObject({
      allowed: false,
      reason: "self",
    });
    expect(
      (await check({ host: "10.0.0.9", port: 8080, purpose: "rest" }, DEFAULT, SELF)).allowed
    ).toBe(true);
  });

  it("applies the default loopback deny to a resolved hostname and to a literal", async () => {
    expect(
      await check({ host: "127.0.0.1", port: 5432, purpose: "database" }, DEFAULT, SELF)
    ).toMatchObject({
      allowed: false,
      reason: "policy",
    });
    expect(
      await check({ host: "localhost", port: 5432, purpose: "database" }, DEFAULT, SELF)
    ).toMatchObject({
      allowed: false,
      reason: "policy",
    });
    expect(
      (await check({ host: "127.0.0.1", port: 5432, purpose: "database" }, parseDenyList([]), SELF))
        .allowed
    ).toBe(true);
  });

  it("reports an unresolvable host", async () => {
    expect(
      await check({ host: "no-such-host.invalid", port: 1, purpose: "files" }, DEFAULT, SELF)
    ).toMatchObject({
      allowed: false,
      reason: "unresolvable",
    });
  });
});

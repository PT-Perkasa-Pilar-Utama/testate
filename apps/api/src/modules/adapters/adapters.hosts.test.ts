import { describe, expect, it } from "bun:test";
import { refusal, unresolvable } from "./adapters.helpers.ts";
import { pickHosts } from "./adapters.hosts.ts";

const INTERFACES = {
  lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
  eth0: [
    { address: "192.168.1.20", family: "IPv4", internal: false },
    { address: "fe80::1", family: "IPv6", internal: false },
  ],
};

describe("host suggestions", () => {
  it("offers the machine's own IPv4 addresses when Testate runs natively", () => {
    expect(pickHosts(INTERFACES, false)).toEqual([
      { host: "192.168.1.20", label: "This machine (eth0)" },
    ]);
  });

  it("offers none of them inside a container, where they are the container's own", () => {
    expect(pickHosts(INTERFACES, true)).toEqual([]);
  });
});

describe("the way out of a name that does not resolve", () => {
  it("tells a container to use the container name or the host alias", () => {
    expect(unresolvable("shop-postgres", true)).toContain("container name");
    expect(unresolvable("host.docker.internal", true)).toContain("host-gateway");
  });

  it("tells a native install to use the machine's address and the published port", () => {
    expect(unresolvable("shop-postgres", false)).toContain("port the container publishes");
    expect(unresolvable("shop-postgres", false)).not.toContain("container name once");
  });

  it("explains loopback inside a container, and leaves other policy hits alone", () => {
    const target = { host: "localhost", port: 5432 };
    const verdict = { allowed: false, reason: "policy", matched: "127.0.0.0/8" } as const;
    expect(refusal(verdict, target, true).message).toContain("Testate itself");
    expect(refusal(verdict, target, false).message).toContain("machine's own address");
    expect(refusal(verdict, { host: "pg.prod.internal", port: 5432 }, true).message).toBe(
      "pg.prod.internal:5432 is blocked (policy)"
    );
  });
});

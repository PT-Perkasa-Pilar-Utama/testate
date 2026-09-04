import { describe, expect, it } from "bun:test";
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

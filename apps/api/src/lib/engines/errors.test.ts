import { describe, expect, it } from "bun:test";
import { translate as mysql } from "./mysql/errors.ts";
import { translate as postgres } from "./postgres/errors.ts";

/** A host with only an IPv6 address, dialled from a machine with no IPv6 route. */
const noRoute = Object.assign(new Error("connect ENETUNREACH 2406:da12::1:5432"), {
  code: "ENETUNREACH",
});

describe("a driver's network failure is unreachable, never batch_failed", () => {
  it("postgres", () => {
    expect(postgres(noRoute, "probe")).toMatchObject({ kind: "unreachable", retriable: true });
  });

  it("mysql", () => {
    expect(mysql(noRoute, "probe")).toMatchObject({ kind: "unreachable", retriable: true });
  });
});

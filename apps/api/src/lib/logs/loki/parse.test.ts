import { describe, expect, it } from "bun:test";

import { linesOf } from "./parse.ts";

// #90, L7 (docs/decisions/2026-10-10-loki.md): an answer cut at the ceiling, a refused login and a
// row that is not one are each refused by name, never read half-way.
const answer = (status: number, body: string, capped = false) => ({
  status,
  body: Buffer.from(body),
  capped,
});

describe("a Loki answer", () => {
  it("cut at the ceiling asks for fewer lines", () => {
    expect(() => linesOf(answer(200, '{"status":"success","data":{', true))).toThrow(
      "Loki's answer passed 10 MB: ask for fewer lines"
    );
  });

  it("refused for its token names the login", () => {
    expect(() => linesOf(answer(403, "forbidden"))).toThrow("Loki refused the login");
  });

  it("with a stamp that is not one is refused, not read", () => {
    const row = { stream: { env: "sit" }, values: [["yesterday", "a line"]] };
    const body = JSON.stringify({
      status: "success",
      data: { resultType: "streams", result: [row] },
    });
    expect(() => linesOf(answer(200, body))).toThrow("Invalid format");
  });
});

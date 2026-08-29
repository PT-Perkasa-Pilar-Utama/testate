import { describe, expect, test } from "bun:test";

import { EMPTY_DRAFT, parseLines, requestBody } from "./rest.presenter.ts";

describe("rest feature", () => {
  test("key=value lines become maps and the draft becomes the POST body", () => {
    expect(parseLines("h", "X-A = 1\n\nX-B=a=b")).toEqual({ "X-A": "1", "X-B": "a=b" });
    expect(() => parseLines("h", "nope")).toThrow('h: "nope" is not key=value');
    expect(
      requestBody({ ...EMPTY_DRAFT, name: "ping", path: "/x", expected_status: "204", body: "" })
    ).toEqual({
      name: "ping",
      method: "GET",
      path: "/x",
      query: {},
      headers: {},
      secrets: {},
      body: null,
      expected_status: 204,
    });
  });
});

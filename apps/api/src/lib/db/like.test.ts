import { describe, expect, it } from "bun:test";

import { likeTerm } from "./like.ts";

describe("a search term on its way into LIKE", () => {
  it("wraps the text so it matches anywhere in the column", () => {
    expect(likeTerm("ada")).toBe("%ada%");
  });

  it("keeps a wildcard someone typed as the character they typed", () => {
    expect(likeTerm("100%")).toBe("%100\\%%");
    expect(likeTerm("a_b")).toBe("%a\\_b%");
  });

  it("escapes the escape, so a backslash cannot smuggle one in", () => {
    expect(likeTerm("c:\\_x")).toBe("%c:\\\\\\_x%");
  });
});

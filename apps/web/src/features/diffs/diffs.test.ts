import { describe, expect, test } from "bun:test";

import { keyLabel, toCreateBody } from "./diffs.presenter.ts";

describe("diffs feature", () => {
  test("the create body targets a state or the literal live (stories 88, 89)", () => {
    expect(toCreateBody({ base_state_id: "s1", target: "live" })).toStrictEqual({
      base_state_id: "s1",
      target: "live",
    });
    expect(toCreateBody({ base_state_id: "s1", target: "s2" })).toStrictEqual({
      base_state_id: "s1",
      target: { state_id: "s2" },
    });
  });

  test("row keys render as text for primary keys and row hashes (story 92)", () => {
    expect(keyLabel({ k: [42, "a"], op: "added", before: null, after: {} })).toBe('42, "a"');
    expect(keyLabel({ k: "h:abc", op: "removed", before: {}, after: null })).toBe("h:abc");
  });
});

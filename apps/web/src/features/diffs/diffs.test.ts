import { describe, expect, test } from "bun:test";

import { changedRows, keyLabel, toCreateBody } from "./diffs.presenter.ts";
import type { Diff } from "@testate/shared";

describe("diffs feature", () => {
  test("changed rows counts added, removed and changed across every adapter and table", () => {
    const table = (
      added: number,
      removed: number,
      changed: number
    ): Diff["adapters"][0]["tables"][0] => ({
      schema: "public",
      name: "orders",
      compare: "primary-key",
      added,
      removed,
      changed,
      unchanged: false,
      schema_changed: null,
    });
    const diff: Pick<Diff, "adapters"> = {
      adapters: [
        {
          adapter_id: "a1",
          name: "shop",
          compared: true,
          tables: [table(2, 1, 3), table(0, 0, 5)],
        },
        { adapter_id: "a2", name: "warehouse", compared: true, tables: [table(1, 0, 0)] },
      ],
    };

    // SAFETY: changedRows reads nothing but `adapters`, and that half is complete here.
    expect(changedRows(diff as Diff)).toBe(12);
  });

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

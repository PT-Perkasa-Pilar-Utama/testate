import { describe, expect, test } from "bun:test";
import type { Hook } from "@testate/shared";

import { movedOrder, toCreateBody } from "./hooks.presenter.ts";

const hook = (id: string, position: number, trigger: Hook["trigger"] = "after_checkout"): Hook => ({
  id,
  trigger,
  request: { id: `r-${id}`, adapter_id: "a1", name: id },
  position,
  enabled: true,
  fail_policy: "continue",
  created_at: "2026-08-29T00:00:00.000Z",
  updated_at: "2026-08-29T00:00:00.000Z",
});
const HOOKS = [hook("a", 1), hook("b", 2), hook("c", 3), hook("x", 1, "after_import")];

describe("hooks feature", () => {
  test("the create body carries trigger, request, and fail policy (stories 101, 102)", () => {
    expect(
      toCreateBody({
        trigger: "after_import",
        adapter_id: "a1",
        rest_request_id: "r1",
        fail_policy: "abort",
      })
    ).toStrictEqual({ trigger: "after_import", rest_request_id: "r1", fail_policy: "abort" });
  });

  test("moving a hook swaps it within its trigger and stops at the ends (story 101)", () => {
    expect(movedOrder(HOOKS, hook("b", 2), -1)).toStrictEqual(["b", "a", "c"]);
    expect(movedOrder(HOOKS, hook("b", 2), 1)).toStrictEqual(["a", "c", "b"]);
    expect(movedOrder(HOOKS, hook("a", 1), -1)).toStrictEqual(["a", "b", "c"]);
    expect(movedOrder(HOOKS, hook("c", 3), 1)).toStrictEqual(["a", "b", "c"]);
  });
});

import { describe, expect, it } from "bun:test";

import { createRowsCache } from "./rows-cache.ts";

describe("rows cache", () => {
  it("serves cached rows, evicts the least recently used past the cap, and skips oversize blobs", () => {
    const cache = createRowsCache<number>(5);
    cache.put("a", [1, 2]);
    cache.put("b", [3, 4]);
    expect(cache.get("a")).toStrictEqual([1, 2]);
    cache.put("c", [5, 6]);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toStrictEqual([1, 2]);
    expect(cache.size()).toBe(4);
    cache.put("huge", [1, 2, 3, 4, 5, 6]);
    expect(cache.get("huge")).toBeUndefined();
    expect(cache.size()).toBe(4);
  });
});

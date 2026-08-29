import { describe, expect, it } from "bun:test";

import { runLanes } from "./lanes.ts";

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

const seen: number[] = [];
/** Lane 2 breaks; the others finish and record themselves. */
async function breaking(item: number): Promise<number> {
  await tick();
  seen.push(item);
  return item === 2 ? Promise.reject(new Error("lane 2 broke")) : item;
}

describe("runLanes", () => {
  it("keeps item order, serialises one lane, and runs lanes in parallel up to the width", async () => {
    let running = 0;
    let peak = 0;
    const order: string[] = [];
    const items = [
      { lane: "a", id: "a1" },
      { lane: "b", id: "b1" },
      { lane: "a", id: "a2" },
      { lane: "c", id: "c1" },
    ];
    const results = await runLanes(
      items,
      (item) => item.lane,
      2,
      async (item) => {
        running += 1;
        peak = Math.max(peak, running);
        order.push(item.id);
        await tick();
        running -= 1;
        return item.id.toUpperCase();
      }
    );
    expect(results).toStrictEqual(["A1", "B1", "A2", "C1"]);
    expect(peak).toBe(2);
    expect(order.indexOf("a2")).toBeGreaterThan(order.indexOf("a1"));
  });

  it("rejects with the first failure after the other lanes settle", async () => {
    await expect(runLanes([1, 2, 3], (item) => String(item), 3, breaking)).rejects.toThrow(
      "lane 2 broke"
    );
    expect(seen.sort()).toStrictEqual([1, 2, 3]);
  });
});

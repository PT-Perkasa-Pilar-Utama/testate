/**
 * Runs `work` over `items` in lanes: items with the same lane key run one after another (two
 * adapters on one database must not restore at once), lanes run in parallel up to `width`.
 * Results keep the item order; the first failure rejects the whole run once every lane settled.
 */
export async function runLanes<T, R>(
  items: T[],
  laneOf: (item: T) => string,
  width: number,
  work: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const lanes = new Map<string, number[]>();
  for (const [index, item] of items.entries()) {
    const key = laneOf(item);
    lanes.set(key, [...(lanes.get(key) ?? []), index]);
  }
  const queue = [...lanes.values()];
  const results: R[] = [];
  const failures: unknown[] = [];
  const worker = async (): Promise<void> => {
    for (let lane = queue.shift(); lane !== undefined; lane = queue.shift()) {
      for (const index of lane) {
        const item = items[index];
        if (item === undefined) continue;
        try {
          results[index] = await work(item, index);
        } catch (cause: unknown) {
          failures.push(cause);
          return;
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(width, queue.length)) }, worker));
  if (failures.length > 0) throw failures[0];
  return results;
}

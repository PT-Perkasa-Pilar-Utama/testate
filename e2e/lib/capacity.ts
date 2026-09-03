/** What the machine reports before the suite starts; every number is read once. */
export type Capacity = {
  cpus: number;
  /** One-minute load average: what is already running, engines and Vite included. */
  load1: number;
  totalGiB: number;
  ci: boolean;
  /** `E2E_WORKERS`, when set: a person's own answer wins over the rule. */
  override?: string | undefined;
};

/** `E2E_WORKERS` as a count, or null: a whole number from 1 to 8 and nothing else. */
function asked(override: string | undefined): number | null {
  if (override === undefined || !/^\d+$/.test(override)) return null;
  const count = Number(override);
  return count >= 1 && count <= 8 ? count : null;
}

/**
 * How many browser tabs to run at once.
 *
 * On CI the runner has nothing else to do: one per core, four at most, since the phases above
 * `flows` are serial anyway. At home the engines, Vite, the API and the person's own work share
 * the cores: half of them, one fewer when the machine is already busy, and two at most when
 * memory is under 12 GiB, since five engines and Chromium tabs both live in it; never fewer than
 * one. `E2E_WORKERS` overrides all of it.
 */
export function workersFor(capacity: Capacity): number {
  const wanted = asked(capacity.override);
  if (wanted !== null) return wanted;
  if (capacity.ci) return Math.max(1, Math.min(4, capacity.cpus));
  let workers = Math.floor(capacity.cpus / 2);
  if (capacity.load1 > capacity.cpus * 0.7) workers -= 1;
  if (capacity.totalGiB < 12) workers = Math.min(workers, 2);
  return Math.max(1, Math.min(4, workers));
}

/** One line for the console, so the choice is never a mystery. */
export function describeCapacity(capacity: Capacity, workers: number): string {
  const source = asked(capacity.override) === null ? "" : " (E2E_WORKERS)";
  return `e2e: ${capacity.cpus} cores, load ${capacity.load1.toFixed(1)}, ${capacity.totalGiB.toFixed(0)} GiB, ci=${capacity.ci ? "yes" : "no"} → ${workers} workers${source}`;
}

/**
 * What one source gave a resource reading (#38): numbers it read, and the keys it could not, each
 * with why. A part that throws marks only its own keys unavailable; the reading still saves (Q5).
 */
import type { ResourceGap, ResourceUnit, ResourceValue } from "@testate/shared";

export type ResourceRead = { values: ResourceValue[]; unavailable: ResourceGap[] };

/** One query or one file, and the keys it answers. */
export type Part = { keys: string[]; read: () => Promise<ResourceRead> };

const REASON_MAX = 300;

export const EMPTY_READ: ResourceRead = { values: [], unavailable: [] };

/** `value` under `key`, or `key` unavailable with `missing` when the source held no number. */
export function valueOr(
  key: string,
  value: number | null | undefined,
  unit: ResourceUnit,
  missing: string
): ResourceRead {
  if (value === null || value === undefined || !Number.isFinite(value))
    return { values: [], unavailable: [{ key, reason: missing }] };
  return { values: [{ key, value, unit }], unavailable: [] };
}

export function merge(reads: ResourceRead[]): ResourceRead {
  return {
    values: reads.flatMap((read) => read.values),
    unavailable: reads.flatMap((read) => read.unavailable),
  };
}

export const reasonOf = (cause: unknown): string =>
  (cause instanceof Error ? cause.message : String(cause)).slice(0, REASON_MAX);

/** Every part at once; a part that fails gives each of its keys the failure as the reason. */
export async function readParts(parts: Part[]): Promise<ResourceRead> {
  const settled = await Promise.allSettled(parts.map((part) => part.read()));
  return merge(
    settled.map((result, index) => {
      if (result.status === "fulfilled") return result.value;
      const reason = reasonOf(result.reason);
      return {
        values: [],
        unavailable: (parts[index]?.keys ?? []).map((key) => ({ key, reason })),
      };
    })
  );
}

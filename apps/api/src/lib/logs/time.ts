/**
 * RFC 3339 stamps as nanoseconds since the epoch, for the engines whose stamps carry more than
 * milliseconds: Docker's `timestamps=1` (#88) and Elasticsearch's `date_nanos` sort values (#92).
 */
const STAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;

/** A stamp as nanoseconds since the epoch, or null when it is not one. */
export function nanosOf(stamp: string): bigint | null {
  const match = STAMP.exec(stamp);
  if (match?.[1] === undefined || match[3] === undefined) return null;
  const ms = Date.parse(`${match[1]}${match[3]}`);
  if (Number.isNaN(ms)) return null;
  return BigInt(ms) * 1_000_000n + BigInt((match[2] ?? "").padEnd(9, "0"));
}

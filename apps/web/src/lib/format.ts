/**
 * Every table printed the raw ISO string the API sends, so "2026-08-30T03:46:56.037Z" sat in the
 * column a person reads to answer "when". The locale is pinned rather than taken from the browser:
 * the day-month order and the 24-hour clock then match the timestamps in the logs beside them.
 */
const WHEN = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

export function formatWhen(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : WHEN.format(at);
}

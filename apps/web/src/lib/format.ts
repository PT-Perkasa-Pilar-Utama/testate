/**
 * Every table printed the raw ISO string the API sends, so "2026-08-30T03:46:56.037Z" sat in the
 * column a person reads to answer "when". The locale is pinned rather than taken from the browser:
 * the day-month order and the 24-hour clock then match the timestamps in the logs beside them.
 *
 * The year is dropped inside the current one. It is the same for every row you are comparing, and
 * carrying it wrapped the column onto two lines.
 */
const THIS_YEAR = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const OTHER_YEAR = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

export function formatWhen(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const format = at.getFullYear() === new Date().getFullYear() ? THIS_YEAR : OTHER_YEAR;
  return format.format(at);
}

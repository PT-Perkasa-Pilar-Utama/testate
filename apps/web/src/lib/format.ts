/**
 * Every table printed the raw ISO string the API sends, so "2026-08-30T03:46:56.037Z" sat in the
 * column a person reads to answer "when".
 *
 * `DD/MM/YYYY HH:mm:ss`, always, including the year and the seconds. The year used to be dropped
 * inside the current one, which reads fine until you are looking at a list that crosses new year
 * and cannot tell which side of it a row is on. The seconds matter here because two jobs a second
 * apart are two different runs.
 *
 * The locale is pinned rather than taken from the browser: the day-month order and the 24-hour
 * clock then match the timestamps in the logs beside them, whoever is reading.
 */
const PARTS = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function formatWhen(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  // en-GB gives "04/03/2019, 09:07:00"; the comma is the only thing between it and the shape asked for.
  return PARTS.format(at).replace(", ", " ");
}

/** `2026-08-30T03:46:56.037Z` -> `2026-08-30`, for a date input's value. */
export function toDateInput(iso: string): string {
  return iso.slice(0, 10);
}

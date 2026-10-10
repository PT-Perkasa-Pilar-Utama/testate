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

/** An ISO instant as a `datetime-local` value in this browser's zone, to the second. */
export function toLocalInput(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return new Date(at.getTime() - at.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
}

/** A `datetime-local` value back to an ISO instant; a blank or broken value is "". */
export function fromLocalInput(value: string): string {
  const at = new Date(value);
  return value === "" || Number.isNaN(at.getTime()) ? "" : at.toISOString();
}

/** `2026-08-30T03:46:56.037Z` -> `2026-08-30`, for a date input's value. */
export function toDateInput(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * "1 project", "2 projects", "1 entry", "3 entries". Every footer passed the plural and printed
 * "1 file stores" the day a list held one thing.
 */
export function counted(count: number, plural: string): string {
  if (count !== 1) return `${count} ${plural}`;
  if (plural.endsWith("ies")) return `1 ${plural.slice(0, -3)}y`;
  if (plural.endsWith("s")) return `1 ${plural.slice(0, -1)}`;
  return `1 ${plural}`;
}

/**
 * An address as a person reads it. Bun reports an IPv4 peer of a dual-stack socket as the mapped
 * form `::ffff:127.0.0.1`, and the sessions table printed that prefix on every row.
 */
export function formatAddress(ip: string): string {
  return ip.replace(/^::ffff:/i, "");
}

/**
 * A stored project scope as a list cell reads it (#55): "All projects", "No projects", or the
 * names. A project the list does not know (deleted, or past the picker's page) counts as a number
 * rather than a bare id.
 */
export function formatScope(
  projectIds: readonly string[] | null,
  projects: readonly { id: string; name: string }[]
): string {
  if (projectIds === null) return "All projects";
  if (projectIds.length === 0) return "No projects";
  const names = new Map(projects.map((project) => [project.id, project.name]));
  const known = projectIds.flatMap((id) => names.get(id) ?? []);
  const unknown = projectIds.length - known.length;
  return unknown === 0 ? known.join(", ") : [...known, counted(unknown, "more")].join(", ");
}

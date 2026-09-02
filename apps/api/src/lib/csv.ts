import type { JsonValue } from "@testate/shared";
import * as v from "valibot";

/** A cell's text: strings as they are, numbers and booleans printed, anything structured as JSON. */
function textOf(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "";
  if (v.is(v.string(), value)) return value;
  return v.is(v.union([v.number(), v.boolean()]), value) ? String(value) : JSON.stringify(value);
}

function quoted(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** RFC 4180, and faithful: what goes out comes back in unchanged. For files Testate reads again. */
export function csvCell(value: JsonValue | undefined): string {
  return quoted(textOf(value));
}

export function csvLine(values: (JsonValue | undefined)[]): string {
  return values.map(csvCell).join(",");
}

/**
 * A cell a spreadsheet would run rather than show: `=`, `+`, `@`, a tab or a return, or a `-`
 * that does not start a number. A leading apostrophe makes it text (OWASP: CSV injection), at
 * the cost of that apostrophe, which is why the writers Testate reads back do not use this.
 */
const FORMULA = /^(?:[=+@\t\r]|-(?![0-9.]))/;

/** For files people open: a query or table export, a diff, the audit log. */
export function exportCell(value: JsonValue | undefined): string {
  const text = textOf(value);
  return quoted(FORMULA.test(text) ? `'${text}` : text);
}

export function exportLine(values: (JsonValue | undefined)[]): string {
  return values.map(exportCell).join(",");
}

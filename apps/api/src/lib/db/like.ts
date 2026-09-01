/**
 * A `LIKE` term for a search box.
 *
 * `%` and `_` are wildcards to SQLite and ordinary characters to the person typing. Searching for
 * `100%` without this matches every row, and a `_` matches any character. Every caller pairs it
 * with `ESCAPE '\'`, which is what makes the added backslashes mean "the literal one".
 */
export function likeTerm(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

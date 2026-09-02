import type { ColumnSchema, Transform } from "@testate/shared";

/**
 * How one file column is read.
 *
 * The wire takes a list of transforms and always has; this is the shorter question a person can
 * answer about a column, and `toTransforms` turns it back into that list. The old form asked for a
 * single transform out of seven wire names, which is the engine's vocabulary rather than anyone
 * else's (docs/PROJECT_REWORK.md).
 */
export type Choice =
  | { kind: "auto" }
  | { kind: "text" }
  | { kind: "number"; locale: string }
  | { kind: "date"; format: string; timezone: string }
  | { kind: "hash"; algorithm: HashAlgorithm };

export type HashAlgorithm = "bcrypt" | "argon2id" | "sha256" | "sha512";

export const AUTO: Choice = { kind: "auto" };

/**
 * The formats a file actually arrives in, plus whatever the reader types.
 *
 * Every one of these describes the **source**: `03/04/2026` is 3 April or 4 March and only the
 * file's author knows which. The target never needs describing, because the column has a type.
 * The tokens are the ones `imports.transforms.ts` reads: yyyy, MM, dd, HH, mm, ss.
 */
export const DATE_FORMATS = [
  { value: "dd/MM/yyyy", label: "31/01/2026  day first" },
  { value: "MM/dd/yyyy", label: "01/31/2026  month first" },
  { value: "yyyy-MM-dd", label: "2026-01-31  year first" },
  { value: "dd/MM/yyyy HH:mm:ss", label: "31/01/2026 14:30:00  day first with a time" },
  { value: "yyyy-MM-dd HH:mm:ss", label: "2026-01-31 14:30:00  year first with a time" },
] as const;

export const NUMBER_LOCALES = [
  { value: "", label: "1,234.56  point for decimals" },
  { value: "id", label: "1.234,56  comma for decimals" },
] as const;

export const HASH_ALGORITHMS = [
  { value: "bcrypt", label: "bcrypt" },
  { value: "argon2id", label: "Argon2id" },
  { value: "sha256", label: "SHA-256" },
  { value: "sha512", label: "SHA-512" },
] as const;

/**
 * The transforms one choice becomes.
 *
 * Auto is not "nothing": it trims, and it turns an empty cell into NULL where the column allows
 * one, because nobody wants an empty string in a nullable date column. `emptyToNull` also
 * short-circuits the rest of the list, so a blank cell never reaches the date or hash step and
 * never becomes a hash of "".
 */
export function toTransforms(choice: Choice, nullable: boolean): Transform[] {
  const head: Transform[] = nullable
    ? [{ kind: "trim" }, { kind: "emptyToNull" }]
    : [{ kind: "trim" }];
  if (choice.kind === "auto" || choice.kind === "text") return head;
  if (choice.kind === "number") {
    return choice.locale === ""
      ? [...head, { kind: "number" }]
      : [...head, { kind: "number", locale: choice.locale }];
  }
  if (choice.kind === "date") {
    return choice.timezone === ""
      ? [...head, { kind: "date", format: choice.format }]
      : [...head, { kind: "date", format: choice.format, timezone: choice.timezone }];
  }
  return [...head, { kind: "hash", algorithm: choice.algorithm }];
}

/** A saved normalizer's transforms back into the one question, so an old normalizer still opens. */
export function toChoice(transforms: readonly Transform[]): Choice {
  for (const transform of transforms) {
    if (transform.kind === "date") {
      return {
        kind: "date",
        format: transform.format,
        timezone: transform.timezone ?? "",
      };
    }
    if (transform.kind === "number") return { kind: "number", locale: transform.locale ?? "" };
    if (transform.kind === "hash" && transform.algorithm !== "hmac_sha256") {
      return { kind: "hash", algorithm: transform.algorithm };
    }
  }
  return AUTO;
}

/** What the dropdown shows once a choice carries a setting: "Date · dd/MM/yyyy", not "Date". */
export function choiceLabel(choice: Choice): string {
  if (choice.kind === "auto") return "Auto";
  if (choice.kind === "text") return "Text";
  if (choice.kind === "number") return choice.locale === "" ? "Number" : "Number · 1.234,56";
  if (choice.kind === "date") return `Date · ${choice.format}`;
  return `Hash · ${choice.algorithm}`;
}

/** Whether a target column takes NULL, which decides whether an empty cell becomes one. */
export function isNullable(columns: readonly ColumnSchema[], target: string): boolean {
  return columns.find((column) => column.name === target)?.nullable ?? true;
}

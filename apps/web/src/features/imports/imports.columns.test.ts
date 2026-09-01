import { describe, expect, test } from "bun:test";

import { AUTO, choiceLabel, isNullable, toChoice, toTransforms } from "./imports.columns.ts";
import type { Choice } from "./imports.columns.ts";

const KINDS = (choice: Choice, nullable: boolean): string[] =>
  toTransforms(choice, nullable).map((transform) => transform.kind);

describe("how a column is read", () => {
  test("auto trims, and empties a nullable column rather than writing an empty string", () => {
    expect(KINDS(AUTO, true)).toEqual(["trim", "emptyToNull"]);
    expect(KINDS(AUTO, false)).toEqual(["trim"]);
  });

  test("a date carries the format that reads the file, and the timezone only when given", () => {
    const withZone = toTransforms(
      { kind: "date", format: "dd/MM/yyyy HH:mm:ss", timezone: "Asia/Jakarta" },
      false
    );
    expect(withZone.at(-1)).toEqual({
      kind: "date",
      format: "dd/MM/yyyy HH:mm:ss",
      timezone: "Asia/Jakarta",
    });
    const without = toTransforms({ kind: "date", format: "yyyy-MM-dd", timezone: "" }, false);
    expect(without.at(-1)).toEqual({ kind: "date", format: "yyyy-MM-dd" });
  });

  test("emptyToNull comes before the date, so a blank cell never parses as one", () => {
    // The engine short-circuits the rest of the list once a value is null, so the order is what
    // stops "" reaching parseDate and failing the whole row.
    const kinds = KINDS({ kind: "date", format: "dd/MM/yyyy", timezone: "" }, true);
    expect(kinds).toEqual(["trim", "emptyToNull", "date"]);
    expect(kinds.indexOf("emptyToNull")).toBeLessThan(kinds.indexOf("date"));
  });

  test("a blank password is never hashed into a hash of nothing", () => {
    const kinds = KINDS({ kind: "hash", algorithm: "bcrypt" }, true);
    expect(kinds).toEqual(["trim", "emptyToNull", "hash"]);
  });

  test("a saved mapping opens as the same question it was saved from", () => {
    const choice: Choice = { kind: "date", format: "dd/MM/yyyy", timezone: "Asia/Jakarta" };
    expect(toChoice(toTransforms(choice, true))).toEqual(choice);
    expect(toChoice(toTransforms({ kind: "number", locale: "id" }, false))).toEqual({
      kind: "number",
      locale: "id",
    });
    expect(toChoice(toTransforms(AUTO, true))).toEqual(AUTO);
  });

  test("the dropdown says which setting was chosen, not just the kind", () => {
    expect(choiceLabel(AUTO)).toBe("Auto");
    expect(choiceLabel({ kind: "date", format: "dd/MM/yyyy", timezone: "" })).toBe(
      "Date · dd/MM/yyyy"
    );
    expect(choiceLabel({ kind: "hash", algorithm: "bcrypt" })).toBe("Hash · bcrypt");
  });

  test("a column nobody knows about is treated as nullable, which is the safer read", () => {
    const columns = [
      {
        name: "id",
        type: "int",
        nullable: false,
        has_default: false,
        generated: false,
        identity: true,
        policy: null,
      },
      {
        name: "note",
        type: "text",
        nullable: true,
        has_default: false,
        generated: false,
        identity: false,
        policy: null,
      },
    ];
    expect(isNullable(columns, "id")).toBe(false);
    expect(isNullable(columns, "note")).toBe(true);
    expect(isNullable(columns, "gone")).toBe(true);
  });
});

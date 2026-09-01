import { describe, expect, test } from "bun:test";

import { missingRequiredFields } from "./adapters.fields.ts";

describe("missingRequiredFields", () => {
  test("names every required config/secret field the create draft left blank", () => {
    expect(missingRequiredFields("postgres", {})).toStrictEqual([
      "Host",
      "Database",
      "User",
      "Password",
    ]);
  });

  test("passes once every required field is filled; an optional one (Port) never blocks it", () => {
    expect(
      missingRequiredFields("postgres", {
        "config.host": "db.sit.internal",
        "config.database": "shop",
        "config.user": "testate",
        "secret.password": "s3cr3t",
      })
    ).toStrictEqual([]);
  });
});

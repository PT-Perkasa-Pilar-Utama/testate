import { describe, expect, test } from "bun:test";

import { toConnectionConfig } from "./connection.ts";

describe("toConnectionConfig", () => {
  test("field form fills the default port and ssl mode and takes the password secret", () => {
    const config = toConnectionConfig(
      "postgres",
      { host: "pg.internal", database: "shop", user: "app" },
      { password: "s3cret" }
    );
    expect(config).toEqual({
      engine: "postgres",
      host: "pg.internal",
      port: 5432,
      database: "shop",
      user: "app",
      password: "s3cret",
      ssl: "prefer",
    });
  });

  test("connection string form parses host, port, database, credentials, and sslmode", () => {
    const config = toConnectionConfig(
      "postgres",
      { connection_string_set: true },
      { connection_string: "postgresql://app:p%40ss@db.internal:6543/shop?sslmode=verify-full" }
    );
    expect(config).toMatchObject({
      host: "db.internal",
      port: 6543,
      database: "shop",
      user: "app",
      password: "p@ss",
      ssl: "require",
    });
  });

  test("refuses a non-postgres URL, a URL without a database, and an engine without a driver", () => {
    expect(() =>
      toConnectionConfig("postgres", {}, { connection_string: "mysql://a:b@h/db" })
    ).toThrow("is not a postgres URL");
    expect(() =>
      toConnectionConfig("postgres", {}, { connection_string: "postgres://a:b@h/" })
    ).toThrow("needs a host and a database");
    expect(() => toConnectionConfig("s3", { host: "h" }, {})).toThrow("has no engine");
    expect(
      toConnectionConfig(
        "mongodb",
        {},
        { connection_string: "mongodb://u:p@h/shop?authSource=admin" }
      )
    ).toMatchObject({ engine: "mongodb", port: 27017, database: "shop", authSource: "admin" });
  });
});

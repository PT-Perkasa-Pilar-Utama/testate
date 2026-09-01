import { describe, expect, test } from "bun:test";

import { parseConnectionUrl, urlPatch } from "./adapters.url.ts";
import type { ParsedUrl } from "./adapters.url.ts";

describe("a connection string taken apart", () => {
  test("host, port, database, user and password from one paste", () => {
    expect(
      parseConnectionUrl("postgresql://tatanan_user:s3cret@10.11.174.203:15432/tatanan")
    ).toStrictEqual({
      engine: "postgres",
      values: {
        host: "10.11.174.203",
        port: "15432",
        user: "tatanan_user",
        password: "s3cret",
        database: "tatanan",
      },
    });
  });

  test("the scheme picks the engine, and postgres answers to both of its names", () => {
    expect(parseConnectionUrl("postgres://h/db")?.engine).toBe("postgres");
    expect(parseConnectionUrl("mysql://h/db")?.engine).toBe("mysql");
    expect(parseConnectionUrl("mongodb+srv://h/db")?.engine).toBe("mongodb");
  });

  test("a file store's path is a starting folder, not a database", () => {
    expect(parseConnectionUrl("sftp://bob@files.example:22220/exports")?.values).toStrictEqual({
      host: "files.example",
      port: "22220",
      user: "bob",
      root_path: "exports",
    });
  });

  test("what the string leaves out stays out, rather than arriving empty", () => {
    expect(parseConnectionUrl("postgres://host/db")?.values).toStrictEqual({
      host: "host",
      database: "db",
    });
  });

  test("a password with an escaped character comes back as the character", () => {
    expect(parseConnectionUrl("postgres://u:p%40ss%3Aword@h/db")?.values["password"]).toBe(
      "p@ss:word"
    );
  });

  test("half a URL is not an error yet, and neither is a scheme with no engine", () => {
    expect(parseConnectionUrl("postgres://")).toBeNull();
    expect(parseConnectionUrl("  ")).toBeNull();
    expect(parseConnectionUrl("redis://h:6379")).toBeNull();
    expect(parseConnectionUrl("not a url at all")).toBeNull();
  });
});

describe("what the form is told to set", () => {
  test("a field the URL is silent about is blanked, not left from the last paste", () => {
    // SAFETY: the string parses; the test asserts the patch, and a null here fails on the read.
    const parsed = parseConnectionUrl("postgres://app@db.sit.internal/orders") as ParsedUrl;
    const patch = urlPatch(parsed);
    expect(patch["config.host"]).toBe("db.sit.internal");
    expect(patch["config.database"]).toBe("orders");
    expect(patch["config.port"]).toBe("");
    expect(patch["secret.password"]).toBe("");
  });

  test("a file store gets its root path, and no database key it has no field for", () => {
    // SAFETY: as above.
    const parsed = parseConnectionUrl(
      "sftp://bob:pw@files.sit.internal:2222/srv/dumps"
    ) as ParsedUrl;
    const patch = urlPatch(parsed);
    expect(patch["config.root_path"]).toBe("srv/dumps");
    expect(patch["config.port"]).toBe("2222");
    expect(patch["secret.password"]).toBe("pw");
    expect(patch["config.database"]).toBeUndefined();
  });
});

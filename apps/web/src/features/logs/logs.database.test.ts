import { describe, expect, test } from "bun:test";

import { labelOf, missingSources, sectionFrom } from "./logs.database.ts";

// #84, D3 and D5 (docs/decisions/2026-10-10-db-server-logs.md): a run link opens the Server logs
// tab, and a source the credential cannot read names the grant that opens it, for its own user.
describe("a database adapter's server logs on screen", () => {
  test("open on the Server logs tab when a link names a source", () => {
    expect([sectionFrom("?source=statements&from=x"), sectionFrom("")]).toEqual(["logs", "data"]);
  });

  test("list each unreadable source with its grant, for the adapter's own user", () => {
    const mysql = { engine: "mysql" as const, config: { host: "db", user: "qa_app" } };
    expect(missingSources(mysql, ["statements"])).toEqual([
      {
        label: "Error log",
        grant: "GRANT SELECT ON performance_schema.error_log TO qa_app; (MySQL 8.0.22 and later)",
      },
      {
        label: "Slow log",
        grant:
          "SET GLOBAL slow_query_log = ON, log_output = 'TABLE'; GRANT SELECT ON mysql.slow_log TO qa_app;",
      },
    ]);
  });

  test("list nothing missing once every source is readable, and nothing for an engine with none", () => {
    expect([
      missingSources({ engine: "postgres", config: {} }, ["statements", "server-log"]),
      missingSources({ engine: "s3", config: {} }, []),
      labelOf("server-log"),
      labelOf("api"),
    ]).toEqual([[], [], "Server log", "api"]);
  });
});

import * as v from "valibot";

/**
 * Database server logs: a read on a database adapter, not a Logs engine (#84; D1–D7 of
 * docs/decisions/2026-10-10-db-server-logs.md). Each source is named for what it is.
 */
export const SERVER_LOG_SOURCES = ["statements", "server-log", "error-log", "slow-log"] as const;
export const serverLogSourceSchema = v.picklist(SERVER_LOG_SOURCES);
export type ServerLogSource = v.InferOutput<typeof serverLogSourceSchema>;

export const SERVER_LOG_LABEL = {
  statements: "Statements",
  "server-log": "Server log",
  "error-log": "Error log",
  "slow-log": "Slow log",
} as const satisfies Record<ServerLogSource, string>;

type DatabaseEngine = "postgres" | "mysql" | "mariadb" | "mongodb";

/**
 * The sources each engine can have, and what opens each one (D3): shown beside a source the
 * credential cannot read. `<user>` is the adapter's database user.
 */
export const SERVER_LOG_GRANTS = {
  postgres: {
    statements:
      "GRANT pg_read_all_stats TO <user>; (without it, other users' statements are hidden)",
    "server-log": "logging_collector = on, and GRANT pg_read_server_files TO <user>;",
  },
  mysql: {
    statements: "GRANT SELECT ON performance_schema.* TO <user>;",
    "error-log": "GRANT SELECT ON performance_schema.error_log TO <user>; (MySQL 8.0.22 and later)",
    "slow-log":
      "SET GLOBAL slow_query_log = ON, log_output = 'TABLE'; GRANT SELECT ON mysql.slow_log TO <user>;",
  },
  mariadb: {
    statements:
      "performance_schema = ON, performance_schema_consumer_events_statements_current = ON and performance_schema_consumer_events_statements_history = ON in the server config, and GRANT SELECT ON performance_schema.* TO <user>;",
    "slow-log":
      "SET GLOBAL slow_query_log = ON, log_output = 'TABLE'; GRANT SELECT ON mysql.slow_log TO <user>;",
  },
  mongodb: {
    statements: 'roles: ["clusterMonitor"] (without it, only this user\'s own operations show)',
    "server-log": 'roles: ["clusterMonitor"] (getLog)',
  },
} as const satisfies Record<DatabaseEngine, Partial<Record<ServerLogSource, string>>>;

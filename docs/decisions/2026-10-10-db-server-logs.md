# Database server logs: decisions

Date: 2026-10-10. Umbrella: #37, step 3. Builds on Q2 of `2026-10-10-logs-tier.md`: database server logs are a read on the existing database adapters, not a Logs engine.

The user delegated these decisions to the advisor; they are recorded as decided at the user's request. Prefix D.

| # | Question | Decision | Why |
|---|----------|----------|-----|
| D1 | Which logs, per engine? | Recent statements and errors, from what each engine shows its own connection. Primary sources need no special role; secondary ones appear only when the probe finds the credential can read them (table below). The general query log stays out. In the UI the sources are named for what they are, "Statements" and "Server log", never one called the other. | `pg_read_file` needs superuser or `pg_read_server_files` and does not exist on RDS, Supabase, Neon or Cloud SQL; `getLog` needs `clusterMonitor`. A source every tester can read must come first. |
| D2 | How are they read? | Inside the database, over the adapter's own connection: one new port method `readServerLog(conn, source, page)` and `serverLogSources: string[]` on the probe result, gated like `canTerminateSessions`. Files on the database host are a `logfile` adapter's job; the connecting guide says so. ADR 0001 gains one line. | One connection, its netguard check and its credential already exist; reading host files would need a second credential per database. |
| D3 | A credential without the rights? | Never a dead tab. The tab lists the sources the credential can read, and for each it cannot, one line with the exact grant (`GRANT pg_read_server_files TO …;`, `GRANT SELECT ON performance_schema.error_log TO …;`, `roles: ["clusterMonitor"]`). With none readable, the empty state lists the grants. Retest picks a new grant up through the probe columns. | A missing privilege is the common case on test databases; the fix belongs on the screen. |
| D4 | Paging, cursor, follow? | A server-log cursor of its own, opaque, `{ before, after }` over a sort key of `(time, id)`, or `(time, ordinal)` where a source has no id; not the file reader's byte-offset marks. Follow polls `after` every 3 s (Q7). Ring buffers say where they end: `getLog` keeps the last 1024 entries and `events_statements_history_long` its configured size (default 10 000), so the last page answers `cut_by: "window"` with a one-line note. The answer stays `LogsPage`. | These are tables and ring buffers, not files. One answer shape keeps the viewer unchanged. |
| D5 | Where in the UI? | A "Server logs" tab on the database adapter page, beside Tables or Collections, mounting the existing viewer with the source list from D3. Not a menu entry: a tier is a menu, and this is a read on a database adapter. The job and checkout rows' Logs menu also lists a project's database adapters that have a server-log source. | Q2 put it on the database adapter. The run links already take any adapter and source. |
| D6 | Agents? | `read_logs` accepts a database adapter: the same read, always masked (Q5, Q9). No new tool. An unknown source answers with the sources there are. | One tool for every log read. |
| D7 | Masking? | Built-in secret patterns apply as everywhere. Statement text is the data, and column policies mask named columns, not free text. So for viewers and agents a statement shows as its normalised digest where the engine keeps one (`pg_stat_statements.query`, MySQL `DIGEST_TEXT`); without one, its quoted strings and numbers become `?`, and a MongoDB `$currentOp` command shows its shape with every value replaced. Testers and admins see raw text. | A `WHERE email = 'x'` line carries a value a viewer must not read; a digest is what the engine itself would show. |

## Sources (D1)

| Engine | Primary (no special role) | Secondary (probe-gated) |
|---|---|---|
| PostgreSQL | `pg_stat_statements` when the extension is on; else `pg_stat_activity` snapshots | the server log: `pg_read_file(pg_current_logfile())` with `pg_read_server_files` |
| MySQL | `performance_schema.events_statements_history_long` | `performance_schema.error_log` (8.0.22+); `mysql.slow_log` when `log_output` includes `TABLE` |
| MariaDB | `performance_schema.events_statements_history_long` | `mysql.slow_log` when `log_output` includes `TABLE` |
| MongoDB | `$currentOp` snapshots | `getLog: "global"` with `clusterMonitor` |

## Build note

Detect each source in the probe the way `canTerminateSessions` is detected (`lib/engines/*/probe.ts`): one cheap read per candidate under a `try`, kept in the probe columns.

## Deferred

| Branch | Reason | Who decides |
|--------|--------|-------------|
| The general query log | Too large, and it is the data; a `logfile` adapter on the host reads it | The user, if asked |
| Managed-host log APIs (RDS `DownloadDBLogFilePortion`, Cloud SQL logging) | A cloud credential and a client each | A step of its own, if asked |

## Docs changed

- docs/adr/0001-dbengine-interface.md: one consequence line for the probe-gated server-log read
- docs/GLOSSARY.md: Source widened to a database adapter's statements and server log

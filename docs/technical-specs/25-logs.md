# 25. Logs

The fourth tier (#37). A Logs adapter reads logs and never writes them: there is no write half on its port. Decisions: [`../decisions/2026-10-10-logs-tier.md`](../decisions/2026-10-10-logs-tier.md).

## 25.1 Decision matrix

| Concern | Decision |
| --- | --- |
| Shape | Adapters of kind `logs`, tier `logs`, in the `adapters` table (rebuilt by migration 0011 to admit them). Always `read_only`; `sandbox` is refused at create and any mode change after, admins included |
| Engines | `logfile` (#69), `ingest` (#75, §25.7), `journald` (#86, §25.9), `docker` (#88, §25.10), `loki` (#90, §25.11), `elasticsearch` (#92, §25.12): every engine the CHECK admits |
| `logfile` | One connection, SFTP or S3, holding named sources `{ name, glob, format, patterns }`. Its files open through the storage resolver as the transport it names, so netguard and host-key trust are shared (05 §5.11) |
| Formats | `pm2`, `json-lines`, `testate` (the wide-event shape of 21), `syslog` (RFC 5424 and 3164), `plain`, `regex` (named groups `time`, `level`, `message`; the rest become fields) |
| Limits | 200 lines by default, 5 000 at most; at most 10 MB read per request; a `from`–`to` window of at most 7 days (older entries are paged with the cursor); an answer cut short names its limit and carries a cursor |
| Live tail | Polling with the `after` cursor every 3 s from the viewer; no stream |
| Masking | Viewers and every agent token get built-in secret patterns masked, plus an adapter's own; testers and admins see raw lines (Q5) |
| Agents | One MCP tool, `read_logs`, the same read as the viewer's, always masked (23) |

## 25.2 Parsing

- A line that does not fit its format is read as plain text, never dropped.
- A timestamp with no zone (pm2's prefix, a naive ISO string, RFC 3164 syslog) is read as UTC; RFC 3164 has no year and is read as this year, or last year when that would be the future.
- Levels come from `level`, `severity`, `lvl` or `log.level`; pino and bunyan numbers map (30 info, 40 warn, 50 error, 60 fatal). With no level, a line from a file named like an error log (`-error`, `-err`, `stderr`) is `error`, any other `info`.
- A line with no time of its own joins the entry above it in the same file, so a stack trace is one entry.
- A read in which no line has a timestamp is an untimed file (pm2 without `--time`): its lines are entries in file order, stamped with the file's modified time, and the answer says `untimed: true`. A window cannot filter them.
- Every line is cut at 16 KB before any pattern runs.

## 25.3 Reading a source

```text
list the glob's directory -> files whose name matches
sort by modified time, newest first
for each file, while bytes read < 10 MB:
  stop if the page is full and this file was last written before the oldest line kept
  read a range from its end (256 KB first; "older" reads up to the cursor's offset)
merge from the end of every file at once: each step takes the newest of the files' last unread entries
grow (double) any short read while the page is not full and there is room
the cursor records, per file, where "older" resumes (the oldest entry this page reached)
and where "after" resumes (the end read)
```

Each file gives up a run from its end and never a line from its middle, so the next page starts exactly where this one stopped: no line is skipped and none is shown twice, even with out-of-order timestamps. A range is read one byte early, so a line that starts on the boundary is kept whole. `after` reads from each file's mark to its end, from 0 for a new file or one that shrank (rotated). The glob is one directory under the connection's root and a pattern on the file name: no `**`, no `~`.

## 25.4 Trust boundary

- The cursor is opaque base64 and parsed with valibot when it comes back; a cursor this server did not give out answers `VALIDATION_ERROR`.
- Tester-supplied regexes (`regex` format, masking patterns) are checked at save: they compile, stay under 200 characters, and hold no nested quantifier. The runtime has no regex timeout; RE2 is the upgrade (marked `ponytail:` in `logs.ts`).
- An agent token cannot trust a first-seen SFTP host key: a person reads the source once first. The same holds for a `journald` adapter's SSH key.
- A `journald` adapter runs one command, `journalctl`, and nothing else. Testate builds every argument from an allow-list and single-quotes each one. Nothing a person types reaches the shell: a unit name is checked at save and again when the command is built, and a cursor is checked by its characters (§25.9).
- A `docker` adapter makes five `GET` calls and nothing else, logs always with `follow=0`. Testate builds each path from a request; a container name is checked against its pattern and URL-encoded (§25.10).
- A `loki` adapter makes two `GET` calls and follows no redirect, which could reach an address netguard never checked. The LogQL query is the user's, never rewritten, and only a log query reads (§25.11).
- An `elasticsearch` adapter makes `GET /` and `POST /{index}/_search` with a body Testate builds. Each index pattern is checked against its pattern and URL-encoded; no exclusion, no `_all` (§25.12).

## 25.5 Component and contract

| Piece | Where |
| --- | --- |
| Formats, levels, sources, config, entry, query, page | `packages/shared/src/schemas/logs.ts` |
| Parsers, joining, masking, the reader, the cursor | `apps/api/src/lib/logs/` |
| Ranged read | `FileSource.readRange` (`lib/files`), SFTP, S3, FTP and memory |
| Config, probe, read-only rule | `modules/adapters` (`adapters.logfile.ts`, `adapters.files.ts`, `adapters.inspect.ts`) |
| Service, routes | `modules/logs` (`api-specs/12-logs.md`) |
| MCP tool | `modules/agent/agent.logs.ts` |
| `ingest`: contract, store, push, token | `schemas/logs.ingest.ts`, `lib/logs/ingest/`, `modules/ingest/`, migration 0012 |
| `journald`: contract, command, parser, page, SSH shell | `schemas/logs.journald.ts`, `lib/logs/journald/`, `modules/adapters/adapters.shell.ts`, `modules/logs/logs.journal.ts` |
| `docker`: contract, calls, frames, pager, transports | `schemas/logs.docker.ts`, `lib/logs/docker/`, `lib/logs/ssh.ts`, `modules/adapters/adapters.docker*.ts`, `modules/logs/logs.docker.ts` |
| `loki`: contract, client, parser, pager | `schemas/logs.loki.ts`, `lib/logs/loki/`, `modules/adapters/adapters.loki*.ts`, `modules/logs/logs.loki.ts` |
| `elasticsearch`: contract, client, parser, pager | `schemas/logs.elasticsearch.ts`, `lib/logs/elasticsearch/`, `lib/logs/http.ts` (shared with Loki), `modules/adapters/adapters.elasticsearch*.ts`, `modules/logs/logs.elasticsearch.ts` |
| Menu, dialog, viewer, run links | `apps/web/src/features/logs/` |

One wide event per read carries `logs_source`, `logs_files`, `logs_bytes`, `logs_entries` and `logs_cut_by`. It never carries a line of the log.

## 25.6 What this does not do

No write, no delete, no retention on a remote log adapter; `ingest` (§25.7) keeps Testate's own copy and has all three. No merged view across adapters (clock drift, per-engine paging). No metrics and no tracing (01 §1.2.18).

## 25.7 `ingest`: apps push their logs

Decisions Q4b and I1–I9 of the decision log. An `ingest` adapter dials nothing: an app posts `testate`-format JSON lines to `POST /api/v1/ingest/{id}` (api-specs 12.6) with the adapter's own token.

| Concern | Decision |
| --- | --- |
| Config | `{ retention_days (1–90, default 7), cap_mb (1–10 240, default 1 024) }`; no secrets, no target, so no probe, no deny-list check, never `sandbox` |
| Token | `tsi_` plus 32 random bytes, one per adapter in `ingest_tokens` (06), SHA-256 stored, shown once on create and on rotation. It pushes to its adapter and reaches nothing else. Not on the Tokens screen |
| Layout | `<data>/logs-ingest/<adapter-id>/<source>/<YYYY-MM-DD>.jsonl`. The source is the line's `service.name`, cut to `[A-Za-z0-9._-]`, no leading dot, 64 characters; `default` without one. The day is the receive day (UTC) |
| Stamping | A line with no `ts` gets the receive time. A `ts` after the receive time is clamped, the sent value kept as `ingest.sent_ts`: the reader assumes no line is newer than its file (§25.3). A line that is not a JSON object is wrapped as `{ ts, level: "info", message, ingest: { malformed: true } }`, never refused, so it never joins the entry above |
| Limits | 1 MB a push (413). `limits.ingest_requests_per_minute` per adapter, default 600 (429). A refused token is charged to its address at 120 a minute; `/ingest` is out of the anonymous budget |
| Cap | A push removes the oldest day files until it fits, never today's. If today alone would pass the cap, the push answers `507 INGEST_FULL` and stores nothing |
| Retention | The daily retention sweep removes day files past `retention_days` and the folder of any adapter that no longer exists. Deleting the adapter or its project removes its folder at once |
| Reading | The `logfile` reader over the folder, format `testate`, built-in masks only (there is no per-source pattern). `GET .../logs/sources` lists the folders |
| People | A tester rotates the token (audited `adapter.ingest_token_rotated`); an admin clears the lines (audited `adapter.logs_cleared`). `testate whereis ingest` prints the folder |
| Not here | Not in Inspect (`PROJECT_READ_ONLY`). Not in a backup (16): copy the folder. A crash can leave a torn last line; the reader shows it as plain text |

One wide event per push carries `ingest_adapter`, `ingest_lines` and `ingest_malformed`, never a line.

## 25.8 Database server logs

Decisions D1–D7 of `docs/decisions/2026-10-10-db-server-logs.md` (#84). A read on a database adapter, not a Logs engine: a "Server logs" tab beside its tables, the same viewer, `GET .../logs` and `read_logs`.

| Engine | Statements (no special role, unless noted) | Also, when the credential can read it |
| --- | --- | --- |
| PostgreSQL | `pg_stat_activity`: each session's latest statement and when it started; other users' sessions need `pg_read_all_stats`. Testate names its own connections `application_name = 'testate'` and leaves them out | Server log: the last 1 MB of `pg_current_logfile()` through `pg_read_file`, with `pg_read_server_files` and `logging_collector = on` |
| MySQL | `performance_schema.events_statements_history` and `_history_long` (on when its consumer is), with `SELECT` on `performance_schema` | Error log: `performance_schema.error_log` (8.0.22+). Slow log: `mysql.slow_log` with `log_output` including `TABLE` and `slow_query_log` on |
| MariaDB | As MySQL, and only with `performance_schema = ON` and the `events_statements_current` and a history consumer on, all off by default | Slow log, as MySQL |
| MongoDB | `currentOp`: every user's operations with `clusterMonitor`, this user's own without it | Server log: `getLog: "global"`, the last 1024 lines in memory, with `clusterMonitor` |

| Concern | Decision |
| --- | --- |
| Finding a source | The probe tries each candidate with the real read and stores the answers in `capabilities.serverLogs`; Retest picks up a new grant. A source the credential cannot read shows its exact grant, never a dead tab |
| Paging | Each source is a bounded window (a snapshot, a ring buffer, a tail) paged newest first by `(time, id)` behind an opaque cursor of its own; follow polls `after` every 3 s; the window's end answers `cut_by: "window"` |
| Times | MySQL statement times are derived from `Uptime`, so they are within a second of the clock |
| Masking | Statement text is the data. A viewer or an agent sees the engine's digest (MySQL `DIGEST_TEXT`), else the statement with its quoted strings and numbers as `?`; a MongoDB command shows its keys with every value as `"?"`; fields show their keys with values hidden; built-in secret patterns apply on top. Testers and admins read raw text |
| One row per session | PostgreSQL "Statements" is one row per session, its latest statement, so a session idle for hours keeps its last query near the top until it runs another |
| What a reader sees | Whatever the engine shows the adapter's own role: on PostgreSQL that can include other users' statements. MySQL and MariaDB statements include Testate's own reads through the same user |
| Not here | The general query log (too large, and it is the data); managed-host log APIs (RDS, Cloud SQL); files on the database host, which a `logfile` adapter reads |

## 25.9 `journald`: a host's systemd journal over SSH

Decisions J1–J6 of `docs/decisions/2026-10-10-journald.md` (#86). A `journald` adapter logs in to a Linux host over SSH and reads its journal with `journalctl -o json`.

| Concern | Decision |
| --- | --- |
| Config | `{ host, port (default 22), user, sources }`, secrets `password` or `private_key` (with `passphrase`). The dialog asks for a password, as the SFTP one does; a key goes through the API |
| Connection | The SFTP adapter's `ssh2` client with an `exec` channel instead of `sftp`. Netguard and host-key trust are shared with `logfile`: a person's first read trusts the key, a changed key answers `CONFLICT host_key_changed` |
| Source | `{ name, units, patterns }`, 1–32 per adapter. `units` holds systemd unit names (`-u`); none reads the whole journal |
| Command | `journalctl -o json --no-pager --quiet -n <N> [-r] [--since=@<s>] [--until=@<s>] [--after-cursor=<c> \| --cursor=<c>] [-u <unit>]... [-p <level>]`. Times go as `@` and whole seconds since the epoch, journalctl's absolute form, so no zone can be misread. There is no `--grep`: the text filter runs in Testate on the page |
| Paging | journald's own `__CURSOR`, inside Testate's opaque cursor. The first page is the last N lines, reversed to newest first. "Older" reads back from the oldest cursor shown, without that line. Follow reads `--after-cursor` the newest shown, and keeps its mark when nothing came |
| Lines | `__REALTIME_TIMESTAMP` is the time. `PRIORITY` 0–2 is `fatal`, 3 `error`, 4 `warn`, 5–6 `info`, 7 `debug`. `MESSAGE` is the message; a byte array is decoded as UTF-8, else shown as `<binary>`. Only `_SYSTEMD_UNIT`, `SYSLOG_IDENTIFIER`, `_PID` and `_HOSTNAME` are kept as fields: `_CMDLINE` and the rest can carry a secret |
| Rights | The SSH user needs the `systemd-journal` group, or root. Test connection runs `journalctl -n 1` and warns `no_journalctl` when the host has no journalctl (exit 127), `no_journal` when it has no journal, and `journal_access` with the `usermod` line when the user cannot read it all |
| Limits | §25.1's: 200 lines, 5 000 at most, 10 MB of output a read (the channel closes there and the page says `cut_by: "bytes"`), a 7-day window |
| Masking | Built-in patterns plus the source's own, for viewers and agents (Q5) |
| Not here | Remote journals over `systemd-journal-gatewayd`; container journals with `--machine`; macOS, which has no journal |

## 25.10 `docker`: a host's container logs through the Engine API

Decisions K1–K7 of `docs/decisions/2026-10-10-docker.md` (#88). A `docker` adapter reads container logs through the Engine API, over SSH to the host's socket or over TCP.

| Concern | Decision |
| --- | --- |
| Config | `ssh`: `{ host, port (22), user, socket_path (/var/run/docker.sock), sources }`, the SFTP login's secrets. `tcp`: `{ host, port (2376), scheme (https or http), tls_cert?, tls_ca?, sources }`, secret `tls_key`, which comes with `tls_cert` and only over https. The dialog has no box for a PEM block: a client certificate goes through the API, and an edit keeps it |
| Connection | `ssh`: journald's login and host-key trust (`lib/logs/ssh.ts`), then an OpenSSH `streamlocal` channel to the socket for each call. `tcp`: a TCP or TLS socket to the address netguard approved; TLS checks the certificate against the host name. One HTTP client speaks over either |
| Calls | `GET /_ping`, `/version`, `/containers/json?all=1`, `/containers/{name}/json`, `/containers/{name}/logs?stdout=1&stderr=1&timestamps=1&follow=0&tail=…[&since=…][&until=…]`. A name matches `^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$`. Times go as seconds with nine decimals |
| Source | `{ name, container, format, regex?, patterns }`, 1–32 per adapter. Each read inspects the container for its TTY and log driver; a missing container answers `NOT_FOUND container_missing`, a driver Docker cannot read back `ENGINE_UNSUPPORTED log_driver` |
| Lines | Without a TTY the body is frames (`[stream, 0, 0, 0, length]`); each stream keeps its own unfinished line, as bytes. With a TTY it is one raw stream. Every line starts with its RFC 3339 stamp. The format's time and level win; else Docker's stamp and `info`. The stream is the field `stream`, never a level. Each line is its own entry: a stack trace is not joined |
| Paging | By position, never by time: Docker takes `tail` before `since` and `until`, and stamps can step back. The first page is `tail=N`. An older page grows the tail from the last depth, doubling while short, and takes the N lines before the oldest shown, found by its stamp, stream and text. A read shorter than its tail is the start of the log. Follow reads `since` the newest shown minus 5 s, with no tail, and keeps the lines after the newest shown. A window with a `to` (a run's, Q8) is one read with no tail, `since` the window's start (or `to` minus 7 days) and `until` its end: the first page is its newest N lines, an older page the N before the oldest shown |
| Limits | §25.1's. Docker streams oldest first, so a read cut at 10 MB loses its newest lines: `tail` is the bound, a grown tail is sized from the read's line length, and older pages with no `to` reach back about 10 MB from a log's end; a window's own size bounds a windowed read. Past either the page says `cut_by: "bytes"` and has no older cursor |
| Probe | `/_ping`, then API 1.41 (Engine 20.10) or later, else `ENGINE_UNSUPPORTED version`. Warnings: `container_missing` (with up to eight names the host has), `log_driver` (only `json-file`, `local` and `journald` read back), `tty`, `plaintext` for http, `docker_access` when the SSH user may not open the socket |
| Not here | Swarm service logs, Kubernetes, a streaming follow. Podman speaks the same API and may work; untested |

## 25.11 `loki`: LogQL through `query_range`

Decisions L1–L8 of `docs/decisions/2026-10-10-loki.md` (#90). A `loki` adapter reads a Loki or Grafana Cloud instance with LogQL log queries.

| Concern | Decision |
| --- | --- |
| Config | `{ url, auth (none, basic, bearer), user?, tenant?, sources }`. `url` is `http(s)`, with a path prefix allowed and no login, query or fragment in it. Secrets per `auth`: `password` (basic; an API token on Grafana Cloud) or `bearer_token`. `tenant` is sent as `X-Scope-OrgID` |
| Connection | Netguard checks the URL's host and port. An `http` URL is pinned to the approved address with its `Host` kept; `https` keeps its host name for TLS. No redirect is followed. A body is read as a stream and stopped at 10 MB |
| Calls | `GET /loki/api/v1/labels` (the probe) and `/loki/api/v1/query_range` |
| Source | `{ name, query, format, regex?, patterns }`, 1–32 per adapter. `query` starts with `{` and has at most 2 000 characters; an answer that is not `streams` (a metric query) is refused at the probe and at every read |
| Lines | Loki's nanosecond stamp is the time; the format gives the level, message and fields, else the label `level`, `detected_level` or `severity`, else `info`. Stream labels are fields, `__error__` included. `file` is `service_name`, else `job` |
| Paging | `direction=backward`; `start` is the window's start, else `end` minus 7 days; Testate's inclusive `to` goes as `end = to + 1 ms`. An older page asks `end` = the oldest stamp + 1 ns and drops the lines already shown at that stamp, found by labels and text. A short page with no `from` searches the 7 days before it; an empty 7-day range ends the paging (`cut_by: "window"`). Follow reads forward from the newest stamp, a page at a time, dropping what was shown there. Requests stay within 5 000 lines, Loki's default limit |
| Filters | Text and level filter the page in Testate; the query is never rewritten |
| Refusals | A 401 names the login, or the tenant when Loki says `no org id`. A lower `max_entries_limit_per_query` is named from Loki's 400. A body past 10 MB answers `ADAPTER_UNREACHABLE` asking for fewer lines |
| Probe | `labels` over the last day, then each source's query with `limit=1`. Warnings: `plaintext` for http; `no_lines` for a source that matched nothing in 24 hours, which is also what a wrong tenant looks like |
| Not here | Metric queries, `/tail` streaming, a custom CA, the text filter pushed into LogQL (deferred to the user) |

## 25.12 `elasticsearch`: `_search` on an index pattern

Decisions E1–E8 of `docs/decisions/2026-10-10-elasticsearch.md` (#92). An `elasticsearch` adapter reads an Elasticsearch or OpenSearch cluster with `_search`.

| Concern | Decision |
| --- | --- |
| Config | `{ url, auth (none, basic, api_key, bearer), user?, tls_ca?, sources }`. Secrets per `auth`: `password`, `api_key` (sent as `ApiKey <key>`, the encoded key Kibana shows) or `bearer_token`. `tls_ca` is the PEM CA of a cluster that signs its own certificate; the dialog takes it in a text box |
| Connection | Loki's door (`lib/logs/http.ts`): netguard, the pin for `http` with `Host` kept, no redirect, a body streamed up to 10 MB, the CA when set. A refused certificate says to set the CA |
| Calls | `GET /` (the probe) and `POST /{index}/_search` |
| Source | `{ name, index, query, time_field (@timestamp), message_field (message), patterns }`, 1–32 per adapter. `index` is 1–8 comma-separated patterns of `[a-z0-9*._+-]`, not starting with `-` or `_`. `query` is a Lucene `query_string`, empty for every document. A Kibana data view is an index pattern here |
| Documents | The hit's sort value on `time_field`, in the nanosecond format, is the time (`date` and `date_nanos` alike). The message is `message_field`, the level `log.level`, `level` or `severity`, each read dotted or nested; the rest of `_source` is the fields; `file` is the index |
| Paging | Sort on `time_field` descending, `exists` on it, no lower bound unless `from`. A page asks `range lte` the mark with `size` = N + the documents shown at the mark, and drops those by a 12-character hash of `_index` and `_id`. The cursor carries at most 200 such hashes (about 4 KB of URL); past that, or with no progress, the page answers `cut_by: "lines"` with no cursor. A short page is the end. Follow asks `range gte` the newest mark ascending, a page at a time; a document indexed late with an earlier stamp is missed until a reload. `track_total_hits` is off |
| Filters | Text and level filter the page in Testate; the query is never rewritten |
| Refusals | A query Elasticsearch cannot run names its reason; a missing time field names the field; a result window its maximum; 401 the login; 403 the `read` privilege; 404 the index; 429 a tripped circuit breaker; a body past 10 MB asks for fewer lines |
| Probe | `GET /`: Elasticsearch 7.10 or OpenSearch 1.0 or later. Then each source with `size: 1` over the last 24 hours. Warnings: `plaintext`; `no_lines`, which also says the pattern may match no index |
| Not here | ES\|QL, EQL, KQL, data views as objects, PIT and scroll, aggregations, an Elastic Cloud ID. OpenSearch is untested |

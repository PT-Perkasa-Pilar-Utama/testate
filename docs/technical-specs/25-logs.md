# 25. Logs

The fourth tier (#37). A Logs adapter reads logs and never writes them: there is no write half on its port. Decisions: [`../decisions/2026-10-10-logs-tier.md`](../decisions/2026-10-10-logs-tier.md).

## 25.1 Decision matrix

| Concern | Decision |
| --- | --- |
| Shape | Adapters of kind `logs`, tier `logs`, in the `adapters` table (rebuilt by migration 0011 to admit them). Always `read_only`; `sandbox` is refused at create and any mode change after, admins included |
| Engines | `logfile` (#69), `ingest` (#75, §25.7). `journald`, `docker`, `loki` and `elasticsearch` follow one step each of #37; the CHECK already admits all six |
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
- An agent token cannot trust a first-seen SFTP host key: a person reads the source once first.

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

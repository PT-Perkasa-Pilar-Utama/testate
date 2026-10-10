# 12. Logs

Module: `logs` ([../technical-specs/25-logs.md](../technical-specs/25-logs.md)). Paths under `/projects/{slug}/adapters/{id}` for adapters of kind `logs`; any other adapter answers `422 ENGINE_UNSUPPORTED { "reason": "tier" }`. Reading is `viewer` and up. The only writes are the `ingest` engine's (12.6 to 12.8): an app pushes lines with its adapter's token, a tester rotates that token, and an admin clears the lines.

## 12.1 `GET .../logs`

**Purpose.** One page of one source, newest first. **Access.** `viewer`. **Input.** Query: `source` (required, a source name on the adapter), `from`, `to` (ISO timestamps), `level` (`trace`…`fatal`: that level and above), `text` (in the message or the fields, case-insensitive, at most 200 characters), `limit` (default 200, max 5 000), `cursor` (older entries, from a previous answer), `after` (newer entries since a previous answer: what follow polls with). **Behavior.** Reads the files the source's glob matches through the files resolver, newest first, at most 10 MB a request (25 §25.3). Viewers and agents get secrets masked. **Output.** `200 { "data": { "entries": [ { "time": "...", "level": "error", "file": "api-error.log", "message": "TypeError: x is undefined\n    at handler (server.ts:42)", "fields": null, "masked": false } ], "cursor": "..." | null, "after": "...", "cut_by": "lines" | "bytes" | "window" | null, "untimed": false } }`. `cursor` is null once every file's start was reached. **Errors.** `NOT_FOUND` (project, adapter, or a source; an unknown source answers `{ "sources": [...] }` with the names there are), `ENGINE_UNSUPPORTED` (not a Logs adapter), `VALIDATION_ERROR` (a query value, or a cursor this server did not give out), `CONFLICT` (SFTP host key changed, or not trusted yet for an agent token), `HOST_BLOCKED`, `ADAPTER_UNREACHABLE`.

## 12.2 `GET .../logs/download`

**Purpose.** The entries a read would return, as JSON lines (S3). **Access.** `viewer`. **Input.** As 12.1. **Output.** `200 application/x-ndjson`, `Content-Disposition: attachment; filename="<adapter>-<source>.jsonl"`: one entry per line, masked exactly as 12.1 would mask them. **Errors.** As 12.1.

## 12.3 `GET /log-adapters`

**Purpose.** Every Logs adapter the caller may see, across projects: the Logs menu. **Access.** `viewer`. **Behavior.** Adapters of kind `logs` in the caller's scope, sorted by name; the same shape and scope as `GET /storage-adapters` (05 §5.11). **Output.** `200` array of adapter objects with `project_slug`, `project_name` and `project_kind`.

## 12.4 MCP `read_logs`

The same read as 12.1 for an agent token, always masked (18). Arguments: `project`, `adapter` (name or id), `source`, and optionally `from`, `to`, `level`, `text`, `limit`, `cursor`. An unknown `source` answers with the names there are.

## 12.5 `GET .../logs/sources`

**Purpose.** The sources a log adapter has: a `logfile` adapter's configured names, or the sources an `ingest` adapter holds (its `service.name` folders with at least one day file). **Access.** `viewer`. **Output.** `200 { "data": ["auth", "billing", "default"] }`. **Errors.** `NOT_FOUND`, `ENGINE_UNSUPPORTED`.

## 12.6 `POST /ingest/{id}`

**Purpose.** An app pushes its logs to an `ingest` adapter (25 §25.7). **Access.** No session and no role: `Authorization: Bearer <ingest token>`, the adapter's own `tsi_...` token. Any other token, an API token included, answers `401`. **Input.** `testate`-format JSON lines (`application/x-ndjson`), one or many; one JSON object is one line. At most 1 MB. **Behavior.** A line's `service.name` is its source (`default` when it has none). A line with no `ts` gets the receive time; a `ts` after the receive time is clamped to it and kept as `ingest.sent_ts`; a line that is not a JSON object is stored as `{ ts, level: "info", message: <the line>, ingest: { malformed: true } }`. Lines are filed by the day they arrive (UTC). **Output.** `202 { "data": { "accepted": 3, "malformed": 1 } }`. **Errors.** `UNAUTHORIZED`; `VALIDATION_ERROR` (no lines); `PAYLOAD_TOO_LARGE` (over 1 MB, nothing stored); `RATE_LIMITED` with `Retry-After` (over `limits.ingest_requests_per_minute`, default 600 per adapter; refused tokens are also charged per address at 120 a minute); `INGEST_FULL` `507` (today's lines alone would pass the adapter's size cap; nothing stored).

```sh
curl -X POST https://testate.example.internal/api/v1/ingest/<adapter-id> \
  -H "Authorization: Bearer tsi_YOUR_TOKEN" -H "Content-Type: application/x-ndjson" \
  --data-binary $'{"level":"error","message":"refund failed","service":{"name":"billing"}}\n'
```

## 12.7 `POST .../ingest-token/rotation`

**Purpose.** Replace an `ingest` adapter's token. **Access.** `qa`. **Behavior.** The old token stops at once. Audited as `adapter.ingest_token_rotated` with the new prefix. **Output.** `200 { "data": { "token": "tsi_...", "prefix": "..." } }`, the token in this answer only. **Errors.** `NOT_FOUND`, `ENGINE_UNSUPPORTED` (not an `ingest` adapter).

## 12.8 `POST .../logs/clear`

**Purpose.** Remove every line an `ingest` adapter holds. **Access.** `admin`. **Behavior.** Audited as `adapter.logs_cleared`. **Output.** `200 { "data": { "cleared": true } }`. **Errors.** `NOT_FOUND`, `ENGINE_UNSUPPORTED`.

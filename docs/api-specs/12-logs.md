# 12. Logs

Module: `logs` ([../technical-specs/25-logs.md](../technical-specs/25-logs.md)). Paths under `/projects/{slug}/adapters/{id}` for adapters of kind `logs`; any other adapter answers `422 ENGINE_UNSUPPORTED { "reason": "tier" }`. Every route is `viewer` and up; there is no write route.

## 12.1 `GET .../logs`

**Purpose.** One page of one source, newest first. **Access.** `viewer`. **Input.** Query: `source` (required, a source name on the adapter), `from`, `to` (ISO timestamps), `level` (`trace`…`fatal`: that level and above), `text` (in the message or the fields, case-insensitive, at most 200 characters), `limit` (default 200, max 5 000), `cursor` (older entries, from a previous answer), `after` (newer entries since a previous answer: what follow polls with). **Behavior.** Reads the files the source's glob matches through the files resolver, newest first, at most 10 MB a request (25 §25.3). Viewers and agents get secrets masked. **Output.** `200 { "data": { "entries": [ { "time": "...", "level": "error", "file": "api-error.log", "message": "TypeError: x is undefined\n    at handler (server.ts:42)", "fields": null, "masked": false } ], "cursor": "..." | null, "after": "...", "cut_by": "lines" | "bytes" | "window" | null, "untimed": false } }`. `cursor` is null once every file's start was reached. **Errors.** `NOT_FOUND` (project, adapter or source), `ENGINE_UNSUPPORTED` (not a Logs adapter), `VALIDATION_ERROR` (a query value, or a cursor this server did not give out), `CONFLICT` (SFTP host key changed, or not trusted yet for an agent token), `HOST_BLOCKED`, `ADAPTER_UNREACHABLE`.

## 12.2 `GET .../logs/download`

**Purpose.** The entries a read would return, as JSON lines (S3). **Access.** `viewer`. **Input.** As 12.1. **Output.** `200 application/x-ndjson`, `Content-Disposition: attachment; filename="<adapter>-<source>.jsonl"`: one entry per line, masked exactly as 12.1 would mask them. **Errors.** As 12.1.

## 12.3 `GET /log-adapters`

**Purpose.** Every Logs adapter the caller may see, across projects: the Logs menu. **Access.** `viewer`. **Behavior.** Adapters of kind `logs` in the caller's scope, sorted by name; the same shape and scope as `GET /storage-adapters` (05 §5.11). **Output.** `200` array of adapter objects with `project_slug`, `project_name` and `project_kind`.

## 12.4 MCP `read_logs`

The same read as 12.1 for an agent token, always masked (18). Arguments: `project`, `adapter` (name or id), `source`, and optionally `from`, `to`, `level`, `text`, `limit`, `cursor`.

# 18. Agent Access (MCP)

Module: `agent` ([../technical-specs/05-module-definitions.md §5.19](../technical-specs/05-module-definitions.md)). Design: [23](../technical-specs/23-agent-access.md). This is the one non-REST surface: JSON-RPC 2.0 over the Model Context Protocol's Streamable HTTP transport.

## 18.1 Transport and authentication

| Item | Value |
| --- | --- |
| Endpoint | `POST /api/v1/mcp` for JSON-RPC requests and notifications; `GET /api/v1/mcp` is not implemented and always answers HTTP `405` |
| Auth | `Authorization: Bearer tst_<token>` of kind `agent` only; cookies ignored; a standard token answers HTTP `403 FORBIDDEN { "reason": "agent_token_required" }`; an agent token on any other route answers `403 { "reason": "agent_token_restricted" }` (story 139) |
| Role | The token carries `viewer` or `qa`, never `admin`. Read tools answer either; the write tools answer `qa` only, and refuse a `viewer` with `isError` and `{ "code": "FORBIDDEN", "details": { "reason": "role" } }` (23 §23.6). `get_job` has no role check and answers either token |
| Session | Not implemented. A client's `Mcp-Session-Id` header is never read; the server keeps no per-session state |
| Protocol version | `2025-03-26` in `initialize`; the server answers with its supported version |
| Caps | Row cap 200 default, 1 000 max; byte budget 1 MiB; time budget 15 s; preview 256 KiB; fixture 500 rows, depth 3 |
| Masks | Always applied; every result carries `masked_columns` (story 138) |
| Audit | Every `tools/call` writes `agent.tool_call` with tool name, argument hash, project, adapter, outcome (story 137) |
| Rate | Two limits stack: `limits.token_requests_per_minute` (default 600) applies to the bearer token itself, checked while the request authenticates, before the body is even read; `limits.agent_requests_per_minute` (default 120) applies per agent token on `/mcp` specifically. Either one over budget answers HTTP `429`; the `/mcp`-specific limit also answers JSON-RPC error `-32000` with `retry_after` |

## 18.2 Methods

| Method | Behavior |
| --- | --- |
| `initialize` | Returns server info `{ "name": "testate", "version" }`, capabilities `{ "tools": {}, "resources": {} }` |
| `tools/list` | The tools in 18.3 with JSON Schema inputs generated from `@testate/shared` |
| `tools/call` | Runs one tool; result `content` is one `text` item holding JSON (below); `isError: true` with a JSON error body on failure |
| `resources/list` | `testate://guide` (the same guide `help` answers, for the caller's role), plus `testate://projects/{slug}/adapters/{id}/schema` and `testate://projects/{slug}/states` for every project and database adapter in scope |
| `resources/read` | The introspection (6.1 shape), the state list (8.1 shape), or the guide's Markdown text (18.3 `help`). A successful read is wrapped as `{ "contents": [{ "uri", "mimeType": "application/json", "text" }] }` — `mimeType` is always `application/json`, even for the guide, whose `resources/list` entry says `text/markdown` |
| `ping` | Empty result |

Unknown methods answer JSON-RPC `-32601`. `prompts/*` and `sampling/*` are not implemented.

Rate limiting (18.1 Rate) is checked before any of this: a rate-limited call, notification or not, answers `429` and nothing below applies. Otherwise, a request with no `id` field is a JSON-RPC notification: the server runs it but answers HTTP `202` with an empty body, never a JSON-RPC response. A request that carries an `id` (a string, a number, or `null`) gets a `200` with a JSON-RPC response, success or error.

## 18.3 Tools

Every tool takes `project` (slug) except `help`, `list_projects` and `get_job`, and, where relevant, `adapter` (id or name). Results are JSON objects serialized into the `text` content item. The table lists all 21 tools in the order `tools/list` returns them.

| Tool | Input | Result | Notes |
| --- | --- | --- | --- |
| `help` | none | The guide, as Markdown (same text `resources/read` returns for `testate://guide`) | for the caller's role; first in `tools/list` |
| `list_projects` | none | `[{ slug, name, head }]` | scope-filtered |
| `list_adapters` | `project` | `[{ id, name, kind, engine, tier, mode }]` | no config |
| `list_tables` | `project`, `adapter` | `[{ schema, name, kind, row_estimate, primary_key, unsupported }]` | database adapters |
| `describe_table` | `project`, `adapter`, `table` | 6.1 table entry plus `foreign_keys_in` and `foreign_keys_out` | |
| `page_rows` | `project`, `adapter`, `table`, `filter?`, `sort?`, `cursor?`, `limit?` | `{ rows, next_cursor, masked_columns }` | 6.2 semantics; cap 200 |
| `get_row` | `project`, `adapter`, `table`, `pk` | `{ row, parents: { "<table>": [rows] }, masked_columns }` | one level of parents |
| `run_readonly_query` | `project`, `adapter`, `sql?`, `mongo?`, `limit?` | `{ columns, rows, truncated, masked_columns }` | read mode only; 6.7 semantics. The schema accepts `mongo` as an alternative to `sql`, but this build ignores it: `sql` is required regardless of adapter engine, and a call without it answers `isError` with `VALIDATION_ERROR` |
| `extract_fixture` | `project`, `adapter`, `table`, `pk`, `depth?`, `direction?`, `format?` | 6.13 result, masked | story 136 |
| `list_states` | `project`, `kind?` | `[{ id, name, kind, parent_state_id, created_at }]` | no stash unless `kind: "stash"` |
| `get_state` | `project`, `state` (id or name) | 8.4 shape without blob hashes | |
| `diff_summary` | `project`, `diff` | 10.2 shape | existing diffs only |
| `list_files` | `project`, `adapter`, `path?`, `cursor?` | 11.1 entries | Files adapters |
| `preview_file` | `project`, `adapter`, `path` | `{ kind: "text" \| "json" \| "csv", content \| rows, truncated }` | 256 KiB; binaries refused |
| `run_write_query` | `project`, `adapter`, `sql`, `limit?` | `{ columns, rows, truncated, masked_columns, write_session_id }` | `qa` only; sandbox adapters; opens or reuses the token's write session; same caps as the read query |
| `end_write_session` | `project`, `adapter` | `{ ended, stash_state_id }` | `qa` only |
| `take_snapshot` | `project`, `name`, `notes?`, `adapters?` | `{ state: { id, name, kind }, job }` | `qa` only; waits 15 s on the job |
| `checkout_state` | `project`, `state` (id or name), `force?`, `adapters?` | `{ checkout: { id, state }, job }` | `qa` only; overwrites data |
| `get_job` | `job` | `{ id, kind, status, progress, error }` | no role check — a `viewer` agent token can poll it too; poll a job past the wait |
| `upload_file` | `project`, `adapter`, `path`, `content`, `base64?` | 11.1 entry | `qa` only; sandbox file adapters; `content` is base64 when `base64: true`, text otherwise; over the byte budget answers `PAYLOAD_TOO_LARGE` |
| `delete_file` | `project`, `adapter`, `path` | `{ deleted: path }` | `qa` only; sandbox file adapters; final, no stash |

Example call and result:

```json
{ "jsonrpc": "2.0", "id": 7, "method": "tools/call",
  "params": { "name": "get_row", "arguments": { "project": "shop", "adapter": "orders-db", "table": "public.orders", "pk": { "id": 88213 } } } }

{ "jsonrpc": "2.0", "id": 7, "result": { "content": [ { "type": "text",
  "text": "{\"row\":{\"id\":88213,\"status\":\"failed\",\"customer_id\":5120,\"card_last4\":\"***\"},\"parents\":{\"public.customers\":[{\"id\":5120,\"email\":\"***\"}]},\"masked_columns\":[\"card_last4\",\"public.customers.email\"]}" } ] } }
```

## 18.4 Errors

Tool failures return `isError: true` with `text` = `{ "code": "<01 §1.6 code>", "message", "details" }`. Transport-level failures are JSON-RPC errors: `-32700` parse, `-32600` invalid request, `-32601` unknown method, `-32602` invalid params (with `data.issues`), `-32000` rate limited. There is no JSON-RPC code for an authentication failure: a missing, wrong-kind or expired token is refused with plain HTTP `401`/`403` by `requireAgentToken` before the body is parsed as JSON-RPC at all (18.1 Auth).

## 18.5 What is not here

No import and no download (story 139; PRD §6). A CI pipeline that needs those uses the REST API with a standard `qa` token. No administration from any agent token, whatever its role.

The write tools were not here either, until an agent token gained a role (23 §23.1). A `viewer` agent token still reaches none of them.

## 18.6 The guide, over REST

`GET /api/v1/agent/guide` returns the same Markdown `help` and `testate://guide` answer, as `text/markdown`. It needs a signed-in session or bearer token with at least the `viewer` role — not an agent token, which reaches nothing but `/mcp` — because it is for whoever is wiring the integration up, before an agent token exists to call `help` with.

It does **not** use the caller's actual role: the handler hardcodes the `viewer` (reader) text regardless of whether the caller signed in as `admin`, `qa`, or `viewer`. `help` and `testate://guide`, by contrast, render the guide for the token's real role. A person previewing the guide for a tester agent over this route sees the reader text, not the tester one.

**Traceability.** Stories 134 to 139, 150.

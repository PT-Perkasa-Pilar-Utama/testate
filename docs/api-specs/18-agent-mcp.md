# 18. Agent Access (MCP)

Module: `agent` ([../technical-specs/05-module-definitions.md §5.19](../technical-specs/05-module-definitions.md)). Design: [23](../technical-specs/23-agent-access.md). This is the one non-REST surface: JSON-RPC 2.0 over the Model Context Protocol's Streamable HTTP transport.

## 18.1 Transport and authentication

| Item | Value |
| --- | --- |
| Endpoint | `POST /api/v1/mcp` for JSON-RPC requests and notifications; `GET /api/v1/mcp` for the optional server-to-client event stream |
| Auth | `Authorization: Bearer tst_<token>` of kind `agent` only; cookies ignored; a standard token answers HTTP `403 FORBIDDEN { "reason": "agent_token_required" }`; an agent token on any other route answers `403 { "reason": "agent_token_restricted" }` (story 139) |
| Session | `Mcp-Session-Id` honored for the SDK's bookkeeping; the server keeps no agent state |
| Protocol version | `2025-03-26` in `initialize`; the server answers with its supported version |
| Caps | Row cap 200 default, 1 000 max; byte budget 1 MiB; time budget 15 s; preview 256 KiB; fixture 500 rows, depth 3 |
| Masks | Always applied; every result carries `masked_columns` (story 138) |
| Audit | Every `tools/call` writes `agent.tool_call` with tool name, argument hash, project, adapter, outcome (story 137) |
| Rate | `limits.agent_requests_per_minute`; over budget answers HTTP `429` and JSON-RPC error `-32000` with `retry_after` |

## 18.2 Methods

| Method | Behavior |
| --- | --- |
| `initialize` | Returns server info `{ "name": "testate", "version" }`, capabilities `{ "tools": {}, "resources": {} }` |
| `tools/list` | The tools in 18.3 with JSON Schema inputs generated from `@testate/shared` |
| `tools/call` | Runs one tool; result `content` is one `text` item holding JSON (below); `isError: true` with a JSON error body on failure |
| `resources/list` | `testate://projects/{slug}/adapters/{id}/schema`, `testate://projects/{slug}/states` for every project and database adapter in scope |
| `resources/read` | The introspection (6.1 shape) or the state list (8.1 shape) as JSON text |
| `ping` | Empty result |

Unknown methods answer JSON-RPC `-32601`. `prompts/*` and `sampling/*` are not implemented.

## 18.3 Tools

Every tool takes `project` (slug) and, where relevant, `adapter` (id or name). Results are JSON objects serialized into the `text` content item.

| Tool | Input | Result | Notes |
| --- | --- | --- | --- |
| `list_projects` | none | `[{ slug, name, head }]` | scope-filtered |
| `list_adapters` | `project` | `[{ id, name, kind, engine, tier, mode }]` | no config |
| `list_tables` | `project`, `adapter` | `[{ schema, name, kind, row_estimate, primary_key, unsupported }]` | database adapters |
| `describe_table` | `project`, `adapter`, `table` | 6.1 table entry plus `foreign_keys_in` and `foreign_keys_out` | |
| `page_rows` | `project`, `adapter`, `table`, `filter?`, `sort?`, `cursor?`, `limit?` | `{ rows, next_cursor, masked_columns }` | 6.2 semantics; cap 200 |
| `get_row` | `project`, `adapter`, `table`, `pk` | `{ row, parents: { "<table>": [rows] }, masked_columns }` | one level of parents |
| `run_readonly_query` | `project`, `adapter`, `sql?`, `mongo?`, `limit?` | `{ columns, rows, truncated, masked_columns }` | read mode only; 6.7 semantics |
| `extract_fixture` | `project`, `adapter`, `table`, `pk`, `depth?`, `direction?`, `format?` | 6.13 result, masked | story 136 |
| `list_states` | `project`, `kind?` | `[{ id, name, kind, parent_state_id, created_at }]` | no stash unless `kind: "stash"` |
| `get_state` | `project`, `state` (id or name) | 8.4 shape without blob hashes | |
| `diff_summary` | `project`, `diff` | 10.2 shape | existing diffs only |
| `list_files` | `project`, `adapter`, `path?`, `cursor?` | 11.1 entries | Files adapters |
| `preview_file` | `project`, `adapter`, `path` | `{ kind: "text" \| "json" \| "csv", content \| rows, truncated }` | 256 KiB; binaries refused |

Example call and result:

```json
{ "jsonrpc": "2.0", "id": 7, "method": "tools/call",
  "params": { "name": "get_row", "arguments": { "project": "shop", "adapter": "orders-db", "table": "public.orders", "pk": { "id": 88213 } } } }

{ "jsonrpc": "2.0", "id": 7, "result": { "content": [ { "type": "text",
  "text": "{\"row\":{\"id\":88213,\"status\":\"failed\",\"customer_id\":5120,\"card_last4\":\"***\"},\"parents\":{\"public.customers\":[{\"id\":5120,\"email\":\"***\"}]},\"masked_columns\":[\"card_last4\",\"public.customers.email\"]}" } ] } }
```

## 18.4 Errors

Tool failures return `isError: true` with `text` = `{ "code": "<01 §1.6 code>", "message", "details" }`. Transport-level failures are JSON-RPC errors: `-32700` parse, `-32600` invalid request, `-32601` unknown method, `-32602` invalid params (with `data.issues`), `-32000` rate limited, `-32001` unauthorized.

## 18.5 What is not here

No write tools, no checkout, no snapshot, no import, no download (story 139; PRD §6). A CI pipeline that needs those uses the REST API with a standard `qa` token.

**Traceability.** Stories 134 to 139, 150.

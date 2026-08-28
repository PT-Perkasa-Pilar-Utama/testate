# 23. Agent Access

Developers debugging on a dev box, SIT, or UAT want an AI agent to inspect the database safely: read a row, follow its relations, copy a reproducible fixture to a local machine, never write. Testate exposes a Model Context Protocol server for that, read-only by construction, on top of the same engine port and the same masks the dashboard uses. This document is the single source for the protocol, the tools, the caps, the auth, and the audit of agent access. Cite it; the user-facing setup lives in `../AGENT_ACCESS.md`.

## 23.1 Decision matrix

| Concern | Decision | Rationale |
| --- | --- | --- |
| Protocol | MCP over Streamable HTTP at `POST ${base}/api/v1/mcp` (JSON-RPC), with the optional `GET` event stream of the same endpoint | The standard agents already speak; one endpoint behind the existing proxy |
| Implementation | `@modelcontextprotocol/sdk` server with the Hono transport (`@hono/mcp`); fallback: an in-house JSON-RPC handler for `initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/read` | Sprint 0 spike; the subset is small |
| Auth | Bearer API token with `kind = agent`; role `viewer`; project scope as any token | Owner decision: viewer role plus an agent flag |
| Read-only | The server registers read tools only; the engine runs every query in read-only mode; write tools do not exist | Read-only by construction, not by policy |
| Masks | Column masks (24 §24.4) apply to every agent response, always | Agents copy values into prompts and files |
| Caps | Row cap 200 default, 1 000 max; byte budget 1 MiB; time budget 15 s; file preview 256 KiB; fixture 500 rows and depth 3; per-token request budget | Lower than the dashboard: an agent loops |
| Audit | Every tool call writes `agent.tool_call` with tool name, argument hash, project, adapter, and outcome; the wide event carries `op.name = "mcp:<tool>"` and `actor.agent = true` | Story 105 |
| Tiers | Tabular and Document adapters expose schema, rows, queries, fixtures; Files adapters expose list, stat, preview; no download through MCP | Agent needs values, not files |
| Sessions | Stateless per request; the `Mcp-Session-Id` header is honored for the SDK's session bookkeeping only | No server-side agent state |
| Resources | `testate://projects/{slug}/adapters/{id}/schema` (introspection as JSON) and `testate://projects/{slug}/states` (state list) | Schema as a resource lets an agent load it once |

## 23.2 Tools

| Tool | Input | Output | Notes |
| --- | --- | --- | --- |
| `list_projects` | none | slug, name, HEAD | scope-filtered |
| `list_adapters` | `project` | id, name, kind, engine, tier, mode | no config |
| `list_tables` | `project`, `adapter` | tables with row estimates, primary keys, unsupported columns | |
| `describe_table` | `project`, `adapter`, `table` | columns (name, type, nullable, default, policy mask flag), keys, foreign keys in and out | |
| `page_rows` | `project`, `adapter`, `table`, `filter?`, `sort?`, `cursor?`, `limit?` | rows (masked), next cursor | keyset when possible |
| `get_row` | `project`, `adapter`, `table`, `pk` | one row (masked) plus the referenced parent rows one level up | |
| `run_readonly_query` | `project`, `adapter`, `sql` or `mongo` | rows (masked), columns, truncated flags | read-only transaction; caps |
| `extract_fixture` | `project`, `adapter`, `table`, `pk`, `depth?`, `direction?`, `format?` | SQL `INSERT`s or JSON fixture (masked) | 24 §24.6 |
| `list_states` | `project`, `kind?` | states with parent, kind, created | |
| `get_state` | `project`, `state` | manifest summary per adapter | no blobs |
| `diff_summary` | `project`, `diff` | per table counts | existing diffs only; no creation |
| `list_files` | `project`, `adapter`, `path?`, `cursor?` | entries | Files tier |
| `preview_file` | `project`, `adapter`, `path` | text or JSON up to 256 KiB; images and binaries refused | |

Tool input schemas are valibot schemas in `@testate/shared`, exported to JSON Schema for `tools/list`. Every tool result carries `masked_columns` when a mask applied, so the agent knows a value is not the real one.

## 23.3 Interface

```ts
// modules/agent/agent.server.ts
createMcpServer(deps: { data; states; diffs; storage; adapters; audit }): McpServer;   // registers tools and resources
// modules/agent/agent.router.ts
router.post("/mcp", requireAgentToken(), mcpTransport(server));
router.get("/mcp", requireAgentToken(), mcpTransport(server));
```

`requireAgentToken()` accepts only tokens with `kind = agent`; a standard token on `/mcp` gets `403 FORBIDDEN { reason: "agent_token_required" }`, and an agent token on any other API route gets `403 { reason: "agent_token_restricted" }`.

## 23.4 Example

```text
agent: describe_table(project="shop", adapter="orders-db", table="public.orders")
→ columns [...], foreign_keys_out [{ columns: ["customer_id"], ref: "public.customers" }]

agent: get_row(project="shop", adapter="orders-db", table="public.orders", pk={ id: 88213 })
→ row { id: 88213, status: "failed", customer_id: 5120, card_last4: "****" }, parents { "public.customers": [{ id: 5120, email: "***@***" }] }, masked_columns ["card_last4", "customers.email"]

agent: extract_fixture(project="shop", adapter="orders-db", table="public.orders", pk={ id: 88213 }, depth=2, format="sql")
→ "INSERT INTO public.customers (...) VALUES (...);\nINSERT INTO public.orders (...) VALUES (...);\n..." (masked values as placeholders)
```

The developer pastes the fixture into a local database and reproduces the failure without a production-like credential on their laptop.

## 23.5 Performance targets

| Path | Target | Source |
| --- | --- | --- |
| `tools/list` | under 50 ms | Static |
| `page_rows`, `get_row` | dashboard grid targets (08 §8.2) | Same path |
| `run_readonly_query` | time budget 15 s | Cap |
| `extract_fixture` | under 5 s for 500 rows, depth 3 | Estimate |
| Request budget | `limits.agent_requests_per_minute` (default 120) | Setting |

## 23.6 Security constraints

- Token kind `agent` is created by an admin with a name, project scope, and expiry (default 90 days, maximum 365).
- The engine runs every agent read with the read-only transaction (SQL) or read credential or filter (MongoDB); the tool layer never has a write path to call.
- Masks are mandatory; there is no "unmask" argument.
- Query text from an agent is stored in `query_history` under the token's label, like any query; wide events carry the hash.
- `/mcp` honors the same CSRF-free bearer path as the API; cookies are ignored on it.
- Rate budget per token; `429` with `Retry-After` maps to a JSON-RPC error with the same data.

## 23.7 Component and contract

`modules/agent/{agent.server.ts, agent.tools.ts, agent.resources.ts, agent.router.ts, agent.test.ts}`; token kind in `api_tokens.kind` (06 §6.3 gains `kind TEXT NOT NULL DEFAULT 'standard'`); `docs/AGENT_ACCESS.md` with Claude Code and generic MCP client configuration. Locked: the tool names and input shapes, the `agent` token kind, the read-only rule.

## 23.8 What this does not do

- No writes, no checkout, no snapshot, no import through MCP. A CI pipeline uses the REST API with a `qa` token for that.
- No file download through MCP.
- No prompts or sampling; tools and resources only.
- No per-agent memory or state.

## 23.9 Cross-references

| Concern | Source |
| --- | --- |
| Masks and fixtures | [24-table-editing.md](24-table-editing.md) §24.4, §24.6 |
| Tokens | 05 §5.2, 09 §9.3 |
| Read-only enforcement | [12-engine-port.md](12-engine-port.md) §12.1 |
| Setup guide | `../AGENT_ACCESS.md` |

## 23.10 Open follow-ups

| Item | Revisit when |
| --- | --- |
| OAuth authorization for MCP clients | Clients stop accepting static bearer headers |
| A `reproduce_locally` prompt that bundles schema, fixture, and the failing query | Developers ask for a one-call workflow |

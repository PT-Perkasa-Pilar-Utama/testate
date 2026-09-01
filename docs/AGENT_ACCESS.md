# Agent Access

Let an AI agent work on a test database through Testate. Every agent reads: rows, relations, fixtures. An agent with the tester role also writes: change rows in a sandbox, keep a state, put an earlier one back. The role on the token decides. Design: [technical-specs/23-agent-access.md](technical-specs/23-agent-access.md). Protocol: [api-specs/18-agent-mcp.md](api-specs/18-agent-mcp.md).

## Start with the guide

An agent does not have to be told how to use Testate. Three doors lead to the same document:

- the `help` tool, first in `tools/list`
- the `testate://guide` resource, first in `resources/list`
- `GET /api/v1/agent/guide`, for whoever is wiring the integration up, with a `viewer` role token rather than an agent token

It covers the layout, the order to call the tools in, what an agent cannot do, and the limits that
refuse a call. Every tool also carries its own description in `tools/list`, so an agent that reads
the list knows what each one answers and what it costs.

## Why it is safe

| Guarantee | How |
| --- | --- |
| Read-only by default | A **Guest** agent token has no write path at all. Every write tool refuses it with `403 role`. `run_readonly_query` runs in a read-only transaction whatever the role, so a read can never turn into a write. |
| Recoverable writes | A **Tester** agent token writes only to sandbox adapters, through the same write session a person uses. The first write stashes the adapter, so there is a state to go back to. Protected adapters refuse the write, and no argument overrides that. |
| Masked | Column policies apply to every agent result. A masked value arrives as `***` and the result lists `masked_columns`. There is no unmask option. |
| Scoped | An agent token carries a role (**Guest** or **Tester**, never Administrator) and a project scope. It reaches `POST /api/v1/mcp` and nothing else. No agent token can create a token, change a setting, or touch a user. |
| Capped | 200 rows per page (1 000 max), 1 MiB per result, 15 s per query, 256 KiB per file preview, 500 rows per fixture. |
| Audited | Every tool call writes `agent.tool_call` with the tool, an argument hash, the project, the adapter, and the outcome. |

## Set up

1. As an admin, open **Tokens** and create a token of kind **agent**. Choose a name, a role, a project scope, and when it expires: **In 90 days**, **On a date** (365 at most), or **Never**. Copy the token; Testate shows it once.

   Pick **Guest** for an agent that investigates and **Tester** for one that runs the tests. A tester agent can overwrite a test database, so give it a project scope.
2. Give the agent the endpoint and the token.

### Claude Code

```sh
claude mcp add --transport http testate https://testate.example.internal/api/v1/mcp \
  --header "Authorization: Bearer tst_..."
```

With a sub-path: `https://example.internal/testate/api/v1/mcp`.

### Any MCP client

```json
{
  "mcpServers": {
    "testate": {
      "type": "http",
      "url": "https://testate.example.internal/api/v1/mcp",
      "headers": { "Authorization": "Bearer tst_..." }
    }
  }
}
```

## Tools

| Tool | Use it to |
| --- | --- |
| `list_projects`, `list_adapters` | Find the project and the database |
| `list_tables`, `describe_table` | Learn the schema, keys, and foreign keys |
| `page_rows`, `get_row` | Read rows; `get_row` adds the parent rows one level up |
| `run_readonly_query` | Run SQL or a MongoDB find, read mode, capped |
| `extract_fixture` | Copy a row and its relations as SQL `INSERT`s or JSON to reproduce locally |
| `list_states`, `get_state`, `diff_summary` | See what the QA team snapshotted and what changed |
| `list_files`, `preview_file` | Browse S3, SFTP, or FTP text files |

Tester tokens get five more. A Guest token sees them in `tools/list` and gets `403 role` if it calls one, which is a clearer answer than a tool that is not there.

| Tool | Use it to |
| --- | --- |
| `run_write_query` | Change rows in a sandbox adapter; the first write stashes it first |
| `end_write_session` | Close the session, so the next write takes a fresh stash |
| `take_snapshot` | Keep the project's data as a named state |
| `checkout_state` | Put a state back over the live databases |
| `get_job` | Poll a snapshot or checkout that was still running when it answered |

Example session for a tester agent:

```text
take_snapshot(project="shop", name="before-my-run")
run_write_query(project="shop", adapter="orders-db", sql="UPDATE public.orders SET status='failed' WHERE id=88213")
... run the test ...
checkout_state(project="shop", state="before-my-run")
```

Example session for a guest agent:

```text
describe_table(project="shop", adapter="orders-db", table="public.orders")
get_row(project="shop", adapter="orders-db", table="public.orders", pk={ "id": 88213 })
extract_fixture(project="shop", adapter="orders-db", table="public.orders", pk={ "id": 88213 }, depth=2, format="sql")
```

The developer pastes the fixture into a local database and reproduces the failure without a shared credential on the laptop.

## Errors

| Response | Cause | Fix |
| --- | --- | --- |
| HTTP 403 `agent_token_required` | A personal token on `/mcp` | Use an agent token |
| HTTP 403 `agent_token_restricted` | An agent token on a REST route | Agents use `/mcp` only |
| HTTP 429 with `Retry-After` | Over `limits.agent_requests_per_minute` (default 120) | Wait; raise the limit in Settings |
| JSON-RPC `-32602` | Invalid tool arguments | Read `tools/list`; the input schema is exact |
| `isError: true` with `NOT_FOUND` | Unknown project, adapter, table, or state | Check scope and names |
| `isError: true` with `FORBIDDEN` and `reason: "role"` | A Guest agent token called a write tool | Create a Tester agent token |
| `isError: true` with `ADAPTER_READ_ONLY` | A write against an adapter that is not in sandbox mode | Write to a sandbox adapter; protected ones refuse by design |

## Revoke

Delete the token under **Tokens**. The next request fails with 401. Expired tokens fail the same way, which is why a token set to never expire is worth a note somewhere a person will read it: nothing else will remind you it exists.

import type { Role } from "@testate/shared";

/**
 * What an agent reads before it calls anything (23 §23.1).
 *
 * `tools/list` used to describe every tool as "Testate read-only tool <name>", which tells an
 * agent nothing it could not read off the name. An agent that has to guess spends calls guessing,
 * and every call is audited and capped. So the descriptions say what the tool answers and what it
 * costs, and the guide below says the order to call them in.
 *
 * It is served three ways because agents arrive by different doors: as the `help` tool, as the
 * `testate://guide` resource, and over REST for anyone building the integration.
 */

/** One line per tool, shown in `tools/list`. Say what it answers, not what it is. */
export const TOOL_DESCRIPTIONS = new Map<string, string>(
  Object.entries({
    help: "Start here. How Testate is laid out, the order to call the other tools in, and the limits that refuse a call.",
    list_projects:
      "The projects this token may see. A project owns the databases behind one system under test. Start here, then use its slug everywhere else.",
    list_adapters:
      "The databases, file stores and REST targets in a project. `kind` says which; only `database` adapters hold tables.",
    list_tables:
      "Table names in one database adapter, with row counts where the engine reports them cheaply. Cheaper than describe_table; use it to find the name you want.",
    describe_table:
      "One table's columns, types, primary key and foreign keys. Read this before page_rows so you know what you can filter and sort on.",
    page_rows:
      "A page of rows, newest cursor last. Pass `cursor` from the previous reply to continue. Masked columns arrive already masked.",
    get_row:
      "One row by primary key. Use it after page_rows when you want a single record rather than a page.",
    run_readonly_query:
      "A SELECT against the adapter, in a read-only transaction. Anything that writes is refused by the database, not by a filter, so do not try to work around it.",
    extract_fixture:
      "One row and the rows it references, as SQL or JSON, following foreign keys up to three hops. Use it to reproduce a bug on another database.",
    list_states:
      "The snapshots taken of a project. A state is data only, taken across every database in the project at one moment.",
    get_state: "One state's tables and row counts, so you can see what it holds before diffing it.",
    diff_summary:
      "What changed between two states, or between a state and the live database, per table. Ask for the diff you need rather than paging both sides yourself.",
    list_files: "Entries in a file adapter (S3, SFTP, FTP). Directories first, then files.",
    preview_file:
      "The head of one file from a file adapter, as text. Binary content is refused rather than mangled.",
    run_write_query:
      "An INSERT, UPDATE or DELETE against a sandbox adapter. The first write of a session stashes the adapter first, so there is something to go back to. Tester tokens only.",
    end_write_session:
      "Closes your write session on an adapter. The next write opens a new one and takes a new stash. Tester tokens only.",
    take_snapshot:
      "Keeps the data of every database in the project as a named state, so you can put it back later. Tester tokens only.",
    checkout_state:
      "Restores a state over the live databases. This overwrites data. Pass `force` only after reading what the refusal said. Tester tokens only.",
    get_job:
      "The status of a snapshot or checkout that was still running when it answered. Poll this rather than holding a call open.",
    upload_file:
      "Writes a file to a sandbox file adapter, overwriting whatever is at that path. Send text in `content`, or bytes as base64 with `base64: true`. Tester tokens only.",
    delete_file:
      "Deletes one file from a sandbox file adapter. Directories are refused. Testate keeps no copy of what you delete. Tester tokens only.",
  })
);

/** Two paragraphs, and which one you get is the role on your token. */
const READER = `You are connected read-only. You can look at anything in scope and change nothing.`;
const TESTER = `Your token has the tester role. You can read anything in scope, write to sandbox
adapters, take a state and put one back. Everything you change is somebody's test environment, so
say what you are about to do before you do it.`;

const READER_LIMITS = `- **No writes.** There is no tool that inserts, updates, deletes, restores or snapshots. \`run_readonly_query\` runs inside a read-only transaction, so the database refuses a write even if you construct one.`;
const TESTER_LIMITS = `- **Writes go to sandbox adapters only.** A read-only adapter refuses every write tool, database or file store, and no argument overrides that.
- **A file delete is final.** A database write stashes first and a state can be checked out again. A file store has neither: what you delete there is gone.
- **You cannot administer.** No tool creates a token, changes a setting, or touches a user. That is a person's job.`;

const TESTER_ORDER = `5. \`run_write_query\` changes rows. The first one stashes the adapter, so a mistake is recoverable.
6. \`take_snapshot\` keeps the result. \`checkout_state\` puts an earlier one back. Both answer with a job; poll \`get_job\` when it is still running.
7. \`upload_file\` and \`delete_file\` change a file store. Nothing stashes a file store, so a delete there is final.`;

/**
 * The guide itself. Markdown, because every agent reads it, and short, because an agent pays for
 * it in context on every session.
 */
export function agentGuide(role: Role): string {
  const tester = role !== "viewer";
  return `# Testate for agents

Testate holds snapshots of the databases behind a system under test, and can restore them.
${tester ? TESTER : READER}

## What is where

A **project** is one system under test. It owns **adapters**, which are the databases, file stores
and REST targets behind it. A **state** is a snapshot of every database in a project, taken at one
moment, holding data and not schema. A **diff** compares two states, or a state against the live
database.

## The order to call things

1. \`list_projects\` gives you slugs. Every other call takes one.
2. \`list_adapters\` gives you the adapters in a project. Only \`kind: "database"\` ones hold tables.
3. \`list_tables\` gives you names. \`describe_table\` gives you columns, keys and types.
4. \`page_rows\` reads rows. Pass the \`cursor\` from the previous reply to continue.
${tester ? TESTER_ORDER : ""}

Read \`describe_table\` before filtering or sorting. A filter on a column that does not exist is a
refused call, and refused calls cost you the same budget as useful ones.

## What you cannot do

${tester ? TESTER_LIMITS : READER_LIMITS}
- **No unmasking.** Columns under a mask policy arrive masked. There is no option to see through them, and asking is a refused call.
- **No reaching outside your scope.** An agent token may be scoped to certain projects. Anything outside answers "not found" rather than "forbidden", on purpose.

## Limits that refuse a call

| Limit | Value |
| --- | --- |
| rows per page, default | 200 |
| rows per page, maximum | 1000 |
| bytes per reply | 1 MiB |
| seconds per query | 15 |
| foreign-key hops in extract_fixture | 3 |

A reply that would exceed the byte budget is truncated with a cursor rather than dropped. A query
past the time budget is cancelled and refused, so prefer a filter over a wide scan.

## Every call is audited

Each tool call writes an audit row: the tool name, a hash of the arguments, the project and adapter
it touched, and whether it succeeded. Assume a person reads it.

## Getting a person to act

${
  tester
    ? `You can reset a database, which means you can also destroy a day of somebody's work. Name the
project and the state before you check one out.`
    : `You cannot reset a database. If the data you need is not there, say which project and state a
person should check out, and let them run it.`
}
`;
}

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
  })
);

/**
 * The guide itself. Markdown, because every agent reads it, and short, because an agent pays for
 * it in context on every session.
 */
export const AGENT_GUIDE = `# Testate for agents

Testate holds snapshots of the databases behind a system under test, and can restore them. You are
connected read-only. You can look at anything in scope and change nothing.

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

Read \`describe_table\` before filtering or sorting. A filter on a column that does not exist is a
refused call, and refused calls cost you the same budget as useful ones.

## What you cannot do

- **No writes.** There is no tool that inserts, updates, deletes, restores or snapshots. \`run_readonly_query\` runs inside a read-only transaction, so the database refuses a write even if you construct one.
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

You cannot reset a database. If the data you need is not there, say which project and state a person
should check out, and let them run it.
`;

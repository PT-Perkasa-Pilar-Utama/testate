# Changelog

## 1.0.0-alpha

First release. Testate snapshots the databases behind a system under test, puts them back on
demand, and shows what changed in between.

```sh
docker pull ghcr.io/pt-perkasa-pilar-utama/testate:1.0.0-alpha
```

The [README](README.md) walks through install, first boot, and connecting a database in three
situations: a container beside Testate, a process on the host, and a managed instance.

### What works

**Snapshots.** A state holds data, not schema. Testate takes one across every database in a project
and restores the one you pick, then reports what happened per database.

**Diffs.** Compare two states, or a state against the live database. The summary says how many rows
moved. Drill into a table to see which ones.

**The grid.** Filter, sort, page by keyset, follow a foreign key into the next table. Turn on write
mode to edit rows, and Testate stashes the table before the first write.

**SQL.** A read-only console with saved queries, so the check you run after every reset stays where
you left it.

**Fixtures.** Upload a CSV or XLSX, map the columns, dry-run it, then import. Rejected rows come
back as a file you can fix and re-import.

**Agents.** Testate speaks MCP. Point Claude or any MCP client at `/api/v1/mcp` with an agent token
and it can read schemas, page rows, run read-only queries, and extract fixtures. It gets no write
tool, and column policies mask values before the agent sees them.

**Pipelines.** Every screen sits on the REST API. `POST /projects/{slug}/checkouts` resets a
database before a test run. The endpoint matrix is in
[docs/api-specs](docs/api-specs/_index.md), and a running instance serves the same contract at
`/api/v1/openapi.json`.

### Engines

| Tier     | Engines                    | What you get                                          |
| -------- | -------------------------- | ----------------------------------------------------- |
| Tabular  | PostgreSQL, MySQL, MariaDB | view, snapshot, checkout, diff, extract, edit, import |
| Document | MongoDB                    | view, snapshot, checkout, diff, extract               |
| Files    | S3, SFTP, FTP              | view, download                                        |
| REST     | any HTTP API               | saved requests, hooks around checkouts                |

Every engine in that table is real. None of them is a stand-in.

### Why alpha

The product works and the tests say so: 336 unit tests, contract suites against every engine, and a
browser suite covering 150 user stories. What it lacks is mileage. Nobody has run it against a
system it did not expect.

Three limits are worth knowing before you install it. Testate resets databases one after another,
not together, so keep the app idle while it runs. It only touches databases you add to it, and it
cannot warn you about the ones you forgot. Microservices are untested, and the limits compound
there.

The README has the full list, and each entry says what to do about it.

### Known issues

Testate ships a one-line patch to `@solidjs/signals`. A node kept a stale transaction stamp after
committing, which made the scheduler spin forever on the data grid. In a development build that
throws. In production it hangs the tab.

The patch is in [patches/](patches/README.md) with the evidence. The same fix is upstream as
[solidjs/solid#3143](https://github.com/solidjs/solid/pull/3143). It goes away when a Solid release
carries it.

### Requirements

Docker 24 with Compose v2, one CPU, 1 GiB of RAM, and a volume for `/data`. Testate needs a route
to every database you point it at. It runs on your own network, and nothing leaves it.

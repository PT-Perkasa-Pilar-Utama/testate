# Changelog

## 1.0.0-beta

The first beta. The number goes down from `1.1.0-alpha`: the alpha line ended at 1.1 and the
beta line starts at 1.0, so `1.0.0-beta` sorts after every alpha in the release list and in
`ghcr.io/pt-perkasa-pilar-utama/testate` tags is read as a name, not compared.

### New

**The dashboard matches the project's homepage.** Near-black ground, one raised surface, teal
for what you can act on, the mark's green for identity, mono labels, tight headings. Every
screen under a project starts with a breadcrumb path. Take state and Check out are the two
solid teal buttons on the states screen.

**HEAD knows when the databases have moved off it.** A write session's first change or an
import marks it; a checkout or a snapshot clears it; "Check for changes" on the HEAD row diffs it
against the live databases and reports whether anything moved. The badge reads "HEAD · modified"
once it has, and Check out on that row goes quiet until then.

**One binary per platform.** Each release attaches a standalone executable for macOS on Apple
silicon, Linux on x86-64 and Windows on x86-64, with the dashboard and the migrations inside it.
See "Without Docker: one binary" in the README.

**Any S3-compatible store.** The S3 engine speaks to Amazon S3, Cloudflare R2, Google Cloud
Storage, Backblaze B2, MinIO and anything else that speaks the protocol; the README's table says
what to put in the endpoint field for each.

**Write mode is a strip under the grid toolbar** with Insert row, the foreign-key switch and End
write mode. The diff page's rail names each database and colours what moved, and opens on the
first table that did. Every action that finished in silence now says so.

### Fixed

- Signing in from `/login` left the address bar on `/login`.
- A succeeded job showed its last progress fraction for good, and a backup's phase read `tar`.
- A list of one said "1 file stores". The sessions table printed `::ffff:127.0.0.1`.
- A state created while the states list was open never appeared until a reload.
- Two Solid diagnostics on every dialog dismissed with Escape or the ✕.

## 1.1.0-alpha

### Breaking

**The default port moves from 3000 to 7378, and the dev server from 5173 to 7379.**

Port 3000 is the default for Next, Rails, Express and most of the JavaScript world, and 5173 is
Vite's, so Testate collided with whatever else you were running. It now uses two ports that IANA
does not assign and nothing else reaches for by habit.

Nothing changes if you set `PORT` yourself. If you rely on the default, the container's internal
port moved, so the mapping has to move with it:

```diff
-  ports: ["3000:3000"]
+  ports: ["7378:7378"]
```

You can keep reaching it on 3000 from outside by mapping `3000:7378`, and `PORT=3000` still works
if you would rather not move at all.

### New

**The sidebar folds away.** It takes 15rem whether or not you are using it, which on a grid with
twenty columns is the difference between reading a row and scrolling for it. The choice is
remembered per browser.

**Action columns stay put.** Edit and Delete used to scroll off the right edge of a wide table, so
you found the row you wanted and then scrolled back to act on it. The column is frozen in all
thirteen tables that have one.

## 1.0.2-alpha

Published for `linux/arm64` as well as `linux/amd64`.

Earlier releases were amd64 only, so Apple Silicon and ARM servers ran the image under emulation:
slower, and with Bun and SQLite that is a failure mode of its own rather than only a delay. Docker
said so on every run:

```
WARNING: The requested image's platform (linux/amd64) does not match the detected host platform
(linux/arm64/v8) and no specific platform was requested
```

Each architecture is now built and slimmed on a runner of its own architecture, boots on that
architecture before anything is pushed, and the two are joined into one manifest list. The same tag
serves both, so nothing changes about how you pull it.

## 1.0.1-alpha

Republishes 1.0.0-alpha, whose image could not start.

`docker-slim` dropped `/data` from the published image. The directory is empty there, because the
app writes into it at runtime and the volume hides it, so nothing touched it while the slimmer
profiled the container. A fresh named volume inherits the ownership of the path it covers, so with
no `/data` in the image Docker created the mount point as root, the container ran as `bun`, and boot
refused:

```
Testate refused to start
TESTATE_DATA_DIR is not writable: /data/blobs (EACCES: permission denied, mkdir '/data/blobs')
```

Only the published artifact was affected. Local builds and the CI image job build the unslimmed
image, where `/data` has always been present and owned by `bun`. The deploy workflow now puts the
directory back after slimming.

Do not use 1.0.0-alpha. It cannot boot against an empty volume, which is every first install.

## 1.0.0-alpha

First release. Testate snapshots the databases behind a system under test, puts them back on
demand, and shows what changed in between.

```sh
docker pull ghcr.io/pt-perkasa-pilar-utama/testate:1.0.1-alpha
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

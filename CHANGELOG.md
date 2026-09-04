# Changelog

## 1.0.1

One fix, for the first thing a person does after the quick start: pointing Testate at a database.

### Fixed

- Inside a container, the chips under the Host field offered the container's own bridge address,
  which no database sits behind. A container offers only `host.docker.internal`, and only when the
  name resolves; a native install keeps its own addresses.
- A host that does not resolve, or a loopback address, was refused with the bare reason. The
  refusal now names the way out for the side of Docker Testate runs on: from a container, the
  database container's name on a shared network or `host.docker.internal` with
  `--add-host=host.docker.internal:host-gateway`; from the binary, this machine's address and
  the port the container publishes, or the loopback entry removed from the deny list.

### Changed

- The image is mirrored to Docker Hub as `snowfluke/testate`, under the same tags and the same
  digest, with its own signature. `docs/CONNECTING.md` gains the `docker run` form of the host
  alias, another machine on the network, and Testate running as the binary against a database in
  Docker.

## 1.0.0

The first release without a suffix. Upgrading from the beta keeps the volume: no migration was
added since.

### New

**A state has a page.** The list's names link to it. A rail names each database and how many
of its tables moved; the pane lists the tables with what each did against the parent state, in
rows added, removed and changed, and a changed table opens its own comparison. Past eight tables
the list takes a search and a sort. The page also says how the state was used: how many
checkouts and comparisons, and when it was last put back. A MongoDB database reads in
collections and documents there, as it does everywhere else.

**Snapshot sits in the project header, on every tab.** It takes every database, always; the
dialog is a viewfinder that lists them, with the name, notes and tags. Taking one runs a shutter
across the page and the snapshot starts when it closes. Edit and Delete sit behind a gear beside
it.

**A document store browses as its console does.** A MongoDB collection opens on the adapter's
own page, switches in place, and shows documents as key and value pairs. The grid filter matches
the typed form the grid shows, so an ObjectId, a Long or a date finds its document. In the query
console the Mongo sample fills every box from real documents, an answer comes back as coloured
JSON, and a saved or past query runs on a click. Results are bounded to the screen. There is no
CSV of documents.

**A comparison that finds nothing is not kept.** The job answers `moved: false` and leaves no
diff behind. The diff page shows only the databases and tables that moved, renders documents as
documents, and opens on the table you came from. The seed now carries a story: a baseline,
a failed refund, and the comparison between them, in every engine.

**A database joins only at the starting point.** Connecting a database, or repointing one, is
refused with `409 CONFLICT` unless HEAD stands on `init` with nothing changed since. The
Databases tab says so and offers the checkout. This is what keeps a snapshot project-wide: every
database in a project shares one history from one root.

**Deleting a project can leave the databases as they are.** The dialog fits one screen, lists
what each database would get, and a switch turns every step into "kept as is".

**Storage stands on its own.** A store is made from the Storage screen as object storage. Its
crumb runs from Storage to the open folder and never hands off to a project. An admin can open a
store for writes, and the batch bar moves, copies or deletes the ticked files; `POST
.../entries/copy` is the endpoint behind it. The seeded store holds an image.

**Every table owns its import.** Import opens from the table's row or from the grid, with sample
CSV and XLSX files beside the picker. The column panel is a table: column, what the file gives
it, how it is read, and its setting. A SHA hash takes a salt; an HMAC takes its secret. The
report counts what went in and what was rejected. Import from a store is gone.

**Checkouts read plainly.** The databases column is one line that opens the details; a failed
checkout offers Put back, Retry, and the sessions that block it; the repair counters appear only
when something failed.

**Smaller things a person will notice.** Help hides behind a (?) that opens on a click and moves
nothing. A back arrow sits beside every title under a project, and column names stand apart from
their types. Activity filters comparisons too. The masks screen takes one table at a time. The
adapter crumb switches to the project's other databases, a connection test answers in a
sentence, the tabs read States, Databases and Activity, and a screen reopens on the tab, view
and chip it was left on. The states screen gains a Compare button; its tree scrolls, opens on HEAD
and checks out from a node; a stash reads apart from a state and takes no editing. Fixture stands
beside Edit on a row, the checkout dialog folds the restore strategy away, the projects list says
who created each project, and the edit adapter dialog explains under its fields rather than in
its labels. Every sentence a person sees states one fact.

**The API and MCP.** `?wait=` now holds a snapshot, an archive import and a comparison the way
it holds a checkout. `run_readonly_query` takes a `mongo` operation. `GET /agent/guide` answers
for the caller's role. `POST /admin/reset-state` drains the dispatcher, wipes blobs, uploads and
imports, and records `reset_state.run`. `docs/SECURITY_STANDARDS.md` gains the ISO map and the
homepage a `security.txt`.

### Changed

- An agent token reaches `/mcp` and nothing else, the session routes included: off it the
  answer is `403`, and `401` once revoked. `get_job` refuses a viewer token like its
  neighbours, and a `resources/read` failure is a JSON-RPC error, `-32002` when the resource is
  missing.
- Instance-wide audit rows, the boot and the resets, are shown to admins only.
- The storage listing answers the limit that applied instead of `200` every time.
- The reset guard counts queued jobs as running.
- Changing an adapter's mode is an admin's, in either direction.
- The `@solidjs/signals` patch is gone: `2.0.0-rc.6` ships the fix.

### Fixed

- A retarget reclaims the orphaned blobs, and cannot fail a live init.
- A project with no database offered Take state; the "consistent snapshot" badge named the
  normal case.
- A click on a saved or past query did nothing.
- A job's progress label overflowed its column.
- A date past what `Date` can hold threw; it shows its digits. The diagram kept its selection on
  a canvas click.
- `reset:dev` removed the checkout along with the environment.

## 1.0.0-beta

The first beta. The number goes down from `1.1.0-alpha`: the alpha line ended at 1.1 and the
beta line starts at 1.0, so `1.0.0-beta` sorts after every alpha in the release list and in
`ghcr.io/pt-perkasa-pilar-utama/testate` tags is read as a name, not compared.

### New

**Ready for a public address, if it must have one.** Strangers share 120 requests a minute per
address under the API, health excepted. The session cookie carries the `__Host-` prefix behind
TLS on a root-path deploy. A new password cannot be on the common list.
`docs/SECURITY_STANDARDS.md` maps the controls to OWASP, the IEEE secure-design flaws and IBM's
practices, and lists what to do before exposing an instance.

**One starting point per project.** Connecting a database used to take a protected init state
of its own, so a project with four databases had four roots and a comparison could pair two of
them by mistake. A project now holds one `init` state that gains each database's baseline as it
connects; retargeting a database replaces its entry; deleting one keeps it. HEAD moves to the
starting point only while the project has no HEAD.

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
- A checkout or a comparison watched from Activity finished without the project header hearing
  of it: HEAD kept its old state and `modified` stayed put until a reload.

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

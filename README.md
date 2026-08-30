![Testate: git for your test database. Testers, CI pipelines and AI agents drive Testate, which runs on the same test server as the system under test and snapshots or restores its databases](docs/assets/hero.svg)

**Git for your test database. Reset the database, not the developer.**

Testate is a self-hosted tool for QA teams. It takes data-only snapshots ("states") of the databases behind a system under test, restores them on demand, diffs them, imports fixtures, and lets an AI agent inspect them read-only. One Docker image, one volume, any sub-path.

| Tier     | Engines                    | What you get                                          |
| -------- | -------------------------- | ----------------------------------------------------- |
| Tabular  | PostgreSQL, MySQL, MariaDB | view, snapshot, checkout, diff, extract, edit, import |
| Document | MongoDB                    | view, snapshot, checkout, diff, extract               |
| Files    | S3, SFTP, FTP              | view, download                                        |
| REST     | any HTTP API               | saved requests, hooks around checkouts                |

REST adapters hold no data of their own. They store the requests you save and the hooks that run around a checkout.

## What you get

**Start with a project per system under test.** It owns the databases behind that system, the
states you take of them, and everything you do to them.

![The projects list, each with its slug, where its HEAD points, and when it last changed](docs/assets/screens/projects.png)

**Point it at the databases behind the system under test.** Each adapter reports its engine and
version, what your login is allowed to do, and whether the database is safe to reset. Object storage
and REST endpoints sit in the same list.

![The adapters tab, listing every adapter in the project with its engine, tier, mode and status](docs/assets/screens/adapters.png)

**Snapshot them.** A state is data only, taken across every database in the project at once, and it
says who took it and what it cost.

![The states tab, listing snapshots with kind, status, adapters, size and author](docs/assets/screens/states.png)

**Put them back.** A checkout restores the state you pick and reports what happened per database.

![The checkouts tab, listing restores with per-adapter results and a retry action](docs/assets/screens/checkouts.png)

**See what a test run changed.** Diff two states, or a state against the live database, and drill
into the rows.

![A diff opened, listing added, removed and changed rows per table across four databases](docs/assets/screens/diffs.png)

**Read and edit the rows.** Filter, page by keyset, follow a foreign key, or turn on write mode and
edit a row with the types the column actually has.

![The data grid for a table, with filters, write mode and typed columns](docs/assets/screens/grid.png)

**Run your own SQL.** A read-only console with saved queries, so the check you run after every
reset is one click away.

![The query console, running a read-only SELECT with its result and a saved query](docs/assets/screens/query.png)

**Load fixtures.** Upload a CSV or XLSX, map the columns, dry-run it, then import for real.

![The imports tab, listing import runs with their counts](docs/assets/screens/imports.png)

**Let an agent look.** Testate speaks MCP, so Claude or any agent can read schemas, page rows, run
read-only queries, and read your snapshots. The token it uses reaches nothing but `/mcp`, and it
cannot write.

## Status

Version 1.0.0-alpha. Every engine in the table is real, not a stand-in. The gate runs on every push:
type-check, lint, format, unit tests, build. A browser suite covers all 150 user stories, each one
tagged with the story it proves.

## Run it

```sh
cp deploy/.env.example deploy/.env
bun scripts/generate-key.ts        # paste into TESTATE_SECRETS_ACTIVE_KEY
# set TESTATE_ADMIN_PASSWORD
docker compose -f deploy/docker-compose.yml up -d
open http://localhost:3000
```

Sign in as `admin`. The first login forces a password change. Create users under **Users**; roles
are `viewer` < `qa` < `admin`.

## What it does not do

| Limit                                                | What happens                                                                                                                                                                                                                                                          | What to do about it                                                                                                                                                                                    |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| It only resets the databases you add to it           | An untracked database is left behind by a reset, and Testate cannot warn you. It has never heard of that database. The app then reads rows that no longer match.                                                                                                      | Put every database your app writes to in one project. One snapshot covers every database in a project, and one checkout restores them all.                                                             |
| Databases go one at a time, not together             | Even in one project, Testate snapshots and restores databases one after another. Each one is correct on its own, but the set is not guaranteed to line up. One restore can fail while another succeeds.                                                               | Keep the app idle while you snapshot or reset.                                                                                                                                                         |
| It has to reach the database from inside a container | A database on another server needs a route, an open firewall, and a login. Inside the container, `127.0.0.1` means the container, not the host. If Testate cannot reach a database, you cannot add it, so a reset skips it.                                           | Point the adapter at `host.docker.internal`, which the compose file carries commented out, and make sure the database listens on that interface.                                                       |
| A snapshot has no owner                              | Two testers sharing one database share everything: either can reset it, and the other's work goes without a warning. Two projects on one database is worse: two unrelated adapters, jobs not kept apart, each taking its own starting snapshot at a different moment. | Run one database, one project, one tester at a time. The connection test warns you when another project already tracks that database.                                                                  |
| It needs a real database connection                  | Testate has to speak the database's own protocol, read every table at one moment, and be allowed to empty and refill tables inside one transaction. Firebase, Firestore, and DynamoDB give you an SDK rather than a connection, so you cannot add them.               | Use an ordinary target instead: Supabase, Neon, RDS, and Cloud SQL all work. On Supabase, use the direct connection rather than the pooler, with a role that owns the tables, or the reset is refused. |
| It resets databases and nothing else                 | Caches, queues, and whatever a running service holds in memory stay untouched, so a service can go on serving rows the database no longer has.                                                                                                                        | Attach a saved request to the `before_checkout` and `after_checkout` hooks to pause the service and clear its cache around the reset.                                                                  |

### Microservices

Not supported yet, and untested. Every limit above compounds: each service owns a database, the services reference each other by id, and Testate resets one database at a time with no shared transaction and no order between them. Two services sharing a database hit the owner problem, and nothing clears the caches in between.

You can still get real use out of it by staying inside one service at a time. Add the databases you do not want touched as **read-only** adapters:

| Works on a read-only adapter                      | Refused                   |
| ------------------------------------------------- | ------------------------- |
| Browse tables, run read queries, save them        | Checkout and reset        |
| Take snapshots and diff them against live         | Import fixtures           |
| Extract a row and its related rows as SQL or JSON | Edit rows, write sessions |
| Let an AI agent read it over MCP                  |                           |

That gives one place to look at data across every service, with no way to break anything. Give the service under test a normal sandbox adapter in its own project, snapshot it, run, reset. Deleting a project leaves read-only adapters alone, so the safe ones stay safe.

## Operating it

Serve under a sub-path by setting `TESTATE_BASE_PATH=/testate`. `deploy/nginx.conf` shows the proxy
block.

The image is `ghcr.io/pt-perkasa-pilar-utama/testate`, built from `deploy/Dockerfile` and slimmed
with docker-slim by the manual **Deploy image** workflow. To publish: run
`bun run bump-version <version>`, then run the workflow. It publishes `<version>` and `latest`, and
skips a version that is already there.

Backups, upgrades, a forgotten admin password, boot refusals and the rest live in the
[deployment plan](docs/DEPLOYMENT_PLAN.md).

## Develop

Requires [Bun](https://bun.sh) 1.4.

```sh
bun install
docker compose -f deploy/compose.engines.yml up -d   # optional target engines
cp deploy/.env.example .env                          # TESTATE_ENV=development, TESTATE_DATA_DIR=./data
bun run dev                                          # API on :3000, Vite on :5173
```

The first boot needs `TESTATE_ADMIN_PASSWORD`; the first login forces a change. Outside production, `POST /api/v1/admin/reset-state` (admin, body `{"confirm":"reset"}`) wipes the metadata, recreates the admin from the environment, and ends every session, yours included.

| Command                  | Does                                                       |
| ------------------------ | ---------------------------------------------------------- |
| `bun run complete-check` | type-check, lint, format check, tests, build. The CI gate. |
| `bun test`               | unit and contract tests                                    |
| `bun run e2e`            | the browser suite; needs the compose engines up            |
| `bun run smoke`          | health checks against a running API (`SMOKE_BASE_URL`)     |
| `bun run bump-version`   | set the version everywhere at once                         |
| `bun run generate-key`   | a new sealed-values key                                    |

## Layout

```text
apps/api        Bun + Hono API; one vertical module per resource (router, handler, service, mock, test)
apps/web        SolidJS 2 SPA; one feature per resource (model, presenter, view); Kumo components
packages/shared valibot schemas: the contract both apps derive their types from
deploy          Dockerfile, compose, nginx, engines for development
docs            PRD, specs, ADRs, standards
```

## Docs

Docs live in `docs/`: the [PRD](docs/PRD.md), the [technical specs](docs/technical-specs/_index.md), the [API specs](docs/api-specs/_index.md), the [coding standard](docs/CODING_STANDARD.md), [key rotation](docs/KEY_ROTATION.md), [agent access](docs/AGENT_ACCESS.md), the [deployment plan](docs/DEPLOYMENT_PLAN.md), and the [browser suite](docs/E2E.md).

## License

MIT. Copyright PT. Perkasa Pilar Utama.

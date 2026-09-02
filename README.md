![Testate: git for your test database. Testers, CI pipelines and AI agents drive Testate, which runs on the same test server as the system under test and snapshots or restores its databases](docs/assets/hero.svg)

[![CI](https://github.com/PT-Perkasa-Pilar-Utama/testate/actions/workflows/ci.yml/badge.svg)](https://github.com/PT-Perkasa-Pilar-Utama/testate/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/PT-Perkasa-Pilar-Utama/testate/badge)](https://scorecard.dev/viewer/?uri=github.com/PT-Perkasa-Pilar-Utama/testate)
[![CodeQL](https://github.com/PT-Perkasa-Pilar-Utama/testate/actions/workflows/codeql.yml/badge.svg)](https://github.com/PT-Perkasa-Pilar-Utama/testate/actions/workflows/codeql.yml)
[![Release](https://img.shields.io/github/v/release/PT-Perkasa-Pilar-Utama/testate?include_prereleases&sort=semver)](https://github.com/PT-Perkasa-Pilar-Utama/testate/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f766e)](LICENSE)

# Testate

[![License: MIT](https://img.shields.io/github/license/PT-Perkasa-Pilar-Utama/testate)](./LICENSE) [![Release](https://img.shields.io/github/v/release/PT-Perkasa-Pilar-Utama/testate?include_prereleases)](https://github.com/PT-Perkasa-Pilar-Utama/testate/releases) [![Container](https://img.shields.io/badge/ghcr.io-testate-blue?logo=docker&logoColor=white)](https://github.com/PT-Perkasa-Pilar-Utama/testate/pkgs/container/testate) [![Bun](https://img.shields.io/badge/Bun-1.4-black?logo=bun)](https://bun.sh)

**Git for your test database. Snapshot it, break it, put it back in seconds.**

Self-hosted, one Docker image, one volume. Testate takes data-only snapshots of the databases behind a system under test, restores any of them on demand, diffs them, loads fixtures from a CSV or a spreadsheet, and lets an AI agent work on them over [MCP](#5-how-to-connect-an-ai-agent-to-a-project). PostgreSQL, MySQL, MariaDB and MongoDB, plus any S3-compatible bucket, SFTP and FTP for the files beside them. Nothing here is a stand-in: every engine in the table below is driven by a real connection, and the suite proves it against real servers.

Reset the database before every test run from [CI](#6-how-to-integrate-into-a-cicd-pipeline), or from the screen below.

![Every state of a project, newest first, with HEAD marked and Check out on each one](docs/assets/screens/states.png)

```sh
docker run -d --name testate -p 7378:7378 -v testate-data:/data \
  -e TESTATE_SECRETS_ACTIVE_KEY="$(openssl rand -base64 32)" \
  -e TESTATE_ADMIN_PASSWORD=change-me-now-1234 \
  ghcr.io/pt-perkasa-pilar-utama/testate:1.0.0-beta
```

Open <http://localhost:7378>, sign in as `admin` with that password, and add a database under **Databases**. Where to point the host is the one thing that catches people out, so read [section 3](#3-connecting-to-a-database) first. Testate makes you change that password on the first login.

That command is fine for a look. For anything you rely on, use Compose and an `.env` file: [how to install](#1-how-to-install).

| Tier     | Engines                            | What you get                                           |
| -------- | ---------------------------------- | ------------------------------------------------------ |
| Tabular  | PostgreSQL, MySQL, MariaDB         | view, snapshot, checkout, diff, extract, edit, import  |
| Document | MongoDB                            | view, snapshot, checkout, diff, extract                |
| Files    | Any S3-compatible store, SFTP, FTP | view, preview, download, insert, rename, delete, batch |

Version 1.0.0-beta.

## Why Testate

- **A reset takes seconds, not a migration run.** A state is the data only. Putting one back writes rows, so a suite that needs a known starting point gets one without rebuilding a schema.
- **Every database in a project at once.** One snapshot covers all of them, and one checkout restores all of them, with a per-adapter result for each.
- **Nothing is written by accident.** A file store is `read_only` until an admin opens it, and any adapter can be tightened to `read_only` by a tester and only loosened by an admin. Deleting a project or an adapter returns its databases to the state they joined with, first.
- **You can see what a test run did.** Diff two states, or a state against the live database, down to the changed cell.
- **Agents get a real seat.** An agent token reaches `/mcp` and nothing else, its role decides whether it may write, and column masks apply before it ever sees a value.
- **Your data stays yours.** One container, one volume, no account, no telemetry. Secrets are sealed with a key you generate and hold.

## Contents

- [Why Testate](#why-testate)
- [What you get](#what-you-get)
- [1. How to install](#1-how-to-install)
- [2. First-time setup](#2-first-time-setup)
- [3. Connecting to a database](#3-connecting-to-a-database)
  - [3a. A database running in Docker, on the same machine as Testate](#3a-a-database-running-in-docker-on-the-same-machine-as-testate)
  - [3b. A database running as a native binary on the host](#3b-a-database-running-as-a-native-binary-on-the-host)
  - [3c. A database in the cloud (managed or remote)](#3c-a-database-in-the-cloud-managed-or-remote)
  - [3d. An object store that is not Amazon's](#3d-an-object-store-that-is-not-amazons)
- [4. How to test the connection](#4-how-to-test-the-connection)
- [5. How to connect an AI agent to a project](#5-how-to-connect-an-ai-agent-to-a-project)
  - [When the token expires](#when-the-token-expires)
- [6. How to integrate into a CI/CD pipeline](#6-how-to-integrate-into-a-cicd-pipeline)
- [What it does not do](#what-it-does-not-do)
  - [Microservices](#microservices)
- [Upgrading, backups, and operating it](#upgrading-backups-and-operating-it)
- [Developing Testate](#developing-testate)
- [Docs](#docs)
- [License](#license)

## What you get

**A project per system under test.** It owns the databases behind that system, the states you take
of them, and everything you do to them. A project opens on its states, with HEAD marked.

**Databases and file stores, side by side.** Each adapter reports its engine and version, what your
login is allowed to do there, and whether the database is safe to reset. A file store sits in the
same project and gets its own screen: browse, preview, upload, rename, make a folder, delete a
batch.

**Snapshot, and put it back.** A state is data only, taken across every database in the project at
one moment, and it says who took it and what it cost. **Check out** restores one; the Activity tab
lists every restore with its per-adapter result and a retry.

**See what a test run changed.** Diff two states, or a state against the live database, and open
the comparison full width: the tables that moved on the left, both sides of every row on the right,
and the changed cell highlighted the way a code review highlights a line.

**Read and edit the rows.** Filter, page by keyset, follow a foreign key, see the tables and their
relations as a diagram, export a whole table as CSV or JSON with no row cap, or turn on write mode
and edit a row with the types the column actually has.

**Run your own SQL.** A read-only console with saved queries and a history, so the check you run
after every reset is one click away.

**Load fixtures.** Upload a CSV or a spreadsheet, or take one straight from a file store, say how
each column is read, check it, then import. That answer is a **normalizer**: which column goes
where, how each value is converted, what happens to a row that is already there. Save it against
the table and next week's import is one press. The check is the guard: nothing is written until it
comes back clean, and the rows a run refused come back as a file you can fix and send again.

**Let an agent work.** Testate speaks MCP, so Claude or any agent can read schemas, page rows, run
read-only queries and read your snapshots. Give the token the Tester role and it can also change
rows in a sandbox, take a state, and put one back. The token reaches `/mcp` and nothing else, and
column masks apply before it sees a value.

## 1. How to install

Requirements: Docker 24 or later with Compose v2, 1 CPU and 1 GiB RAM minimum, a volume for `/data`, and outbound network access from the host to every database and file store you plan to connect.

```sh
mkdir -p /opt/testate && cd /opt/testate
curl -O https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/testate/main/deploy/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/testate/main/deploy/.env.example
```

Generate a sealing key and put it in `.env`:

```sh
openssl rand -base64 32
```

Paste the output into `TESTATE_SECRETS_ACTIVE_KEY=` in `.env`. Then set `TESTATE_ADMIN_PASSWORD` (see step 2), and `TESTATE_PUBLIC_URL` to the address you will reach Testate at.

```sh
docker compose up -d
docker compose logs -f testate   # wait for the boot line
```

Testate listens on port 7378 inside the container; `docker-compose.yml` publishes it as `7378:7378`. All state lives on the `testate-data` volume, mounted at `/data` (`metadata.db`, blobs, logs, uploads). The container filesystem is otherwise read-only.

To serve Testate under a sub-path instead of the domain root, set `TESTATE_BASE_PATH=/testate` (leading slash, no trailing slash) and restart. `deploy/nginx.conf` is a matching reverse-proxy example.

### Without Docker: one binary

Every release carries a standalone executable for macOS on Apple silicon, Linux on x86-64 and
Windows on x86-64, with the dashboard and the migrations inside it. Download it from the
[releases page](https://github.com/PT-Perkasa-Pilar-Utama/testate/releases), then:

```sh
chmod +x testate-*-darwin-arm64          # macOS and Linux only
TESTATE_DATA_DIR=./testate-data \
TESTATE_SECRETS_ACTIVE_KEY="$(openssl rand -base64 32)" \
TESTATE_ADMIN_PASSWORD=change-me-now-1234 \
./testate-*-darwin-arm64
```

It listens on port 7378 and keeps everything under `TESTATE_DATA_DIR`, which has to be set: the
default is the image's `/data`. Every other variable in `deploy/.env.example` applies the same way.
The dashboard and the migrations are unpacked under `<data dir>/run/app/<version>/` on every boot.

### Verify a download

Every release is built by this repository's own workflow and leaves a trail you can check
without trusting us. The image carries SLSA build provenance in the registry and a keyless
Sigstore signature on its digest:

```sh
gh attestation verify oci://ghcr.io/pt-perkasa-pilar-utama/testate:1.0.0-beta \
  --repo PT-Perkasa-Pilar-Utama/testate
cosign verify ghcr.io/pt-perkasa-pilar-utama/testate:1.0.0-beta \
  --certificate-identity-regexp 'https://github.com/PT-Perkasa-Pilar-Utama/testate/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

Each binary archive on the release has the same provenance and a `.sigstore.json` bundle beside
it, and the release carries a CycloneDX SBOM of everything inside:

```sh
gh attestation verify testate-1.0.0-beta-linux-x64.tar.gz --repo PT-Perkasa-Pilar-Utama/testate
cosign verify-blob testate-1.0.0-beta-linux-x64.tar.gz \
  --bundle testate-1.0.0-beta-linux-x64.tar.gz.sigstore.json \
  --certificate-identity-regexp 'https://github.com/PT-Perkasa-Pilar-Utama/testate/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

A download that fails either check is not ours. `SECURITY.md` says how to report it.

## 2. First-time setup

Open the address you set as `TESTATE_PUBLIC_URL` (or `http://<host>:7378` with no proxy in front).

The admin account comes from the environment on first boot only. `TESTATE_ADMIN_PASSWORD` is read while the users table is empty; once one user exists, Testate ignores it. Sign in as `TESTATE_ADMIN_USER` (default `admin`) with that password. The first login forces a password change. After that, remove `TESTATE_ADMIN_PASSWORD` from `.env`. It has no further effect, and there is no reason to leave a plaintext password sitting in the file.

Create the rest of your users under **Users**. Roles are cumulative: `viewer` < `qa` < `admin`. Only an admin can create users, tokens, and change settings.

If the last admin forgets their password, nobody else can reset it from the dashboard. Recovery is `TESTATE_ADMIN_PASSWORD_RESET=true` plus a new `TESTATE_ADMIN_PASSWORD` in `.env`, then a restart. See "Forgotten password" in [docs/DEPLOYMENT_PLAN.md](docs/DEPLOYMENT_PLAN.md).

## 3. Connecting to a database

Open a project, go to **Databases**, and click **New adapter**. For a database engine (PostgreSQL, MySQL, MariaDB, MongoDB) the form asks for Host, Port, Database, User, and Password. Where you point "Host" depends on where the database actually runs.

Testate connects out to the database from inside its own container. `127.0.0.1` or `localhost` in that form means the Testate container itself, never the machine it runs on. The default address deny list also blocks `127.0.0.0/8` and `::1/128` outright, so a loopback address will not connect even by accident.

### 3a. A database running in Docker, on the same machine as Testate

Put both containers on the same Docker network, then use the target container's name as the host and its **internal** port, not the port it publishes to the host.

```sh
docker ps --format '{{.Names}}'                        # find the two container names
docker network create testate-net
docker network connect testate-net <testate-container>       # e.g. testate-testate-1
docker network connect testate-net <your-db-container>       # e.g. shop-postgres
```

Once connected, a container's own name is its DNS name on that network. Adapter form: Host `<your-db-container>`, Port `5432` (Postgres's own port inside the container, not whatever you mapped it to on the host).

### 3b. A database running as a native binary on the host

Uncomment `extra_hosts` in `deploy/docker-compose.yml` and restart:

```yaml
services:
  testate:
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

Adapter form: Host `host.docker.internal`, Port whatever the native process listens on (`5432` for a default Postgres install). The database must also listen on that interface. A Postgres bound only to `127.0.0.1` in `postgresql.conf` is unreachable from the container even with `extra_hosts` set; bind it to `0.0.0.0` or the Docker bridge address instead.

### 3c. A database in the cloud (managed or remote)

Adapter form: Host is the provider's address or DNS name, Port its usual port. Nothing extra to configure on the Testate side beyond a route from the host running Testate to that address (an open firewall, a VPN, a public endpoint, whatever your provider needs).

On Supabase specifically, use the direct connection string, not the pooler, and a role that owns the tables. The pooler refuses the transaction shape a restore needs.

### 3d. An object store that is not Amazon's

There is one storage engine, `s3`, and it speaks to anything that speaks S3. The **Endpoint** field
is the whole of it: leave it empty for Amazon, fill it in for everyone else. Addressing style is
the other half, and the two go together.

| Store                    | Endpoint                                        | Region                        | Bucket in the hostname |
| ------------------------ | ----------------------------------------------- | ----------------------------- | ---------------------- |
| Amazon S3                | leave empty                                     | the bucket's own, `eu-west-1` | **on**                 |
| Cloudflare R2            | `https://<account-id>.r2.cloudflarestorage.com` | `auto`                        | off                    |
| Google Cloud Storage     | `https://storage.googleapis.com`                | the bucket's own              | off                    |
| Backblaze B2             | `https://s3.<region>.backblazeb2.com`           | the region in that host       | off                    |
| MinIO, Ceph, or your own | wherever it listens                             | anything the server accepts   | off                    |

Amazon stopped accepting path-style addressing for buckets created after September 2020, which is
why theirs is the one that wants the bucket in the hostname. Every other store here is happy with
path style and several only accept it.

Two credentials, whoever the provider is: an access key id and a secret access key. Google Cloud
Storage does not hand those out with a service account; they come from **Interoperability** in the
Cloud Storage settings, as an HMAC key for a service account, and that is the only mode of theirs
this speaks.

Tested here: Amazon's own protocol against MinIO, on every operation, in `bun run contract`. The
others are the same code path with a different endpoint and are not in that suite, because it runs
without credentials to anybody's cloud. **Test connection** in the New adapter dialog is the check
that matters for yours; it lists the bucket before anything is saved.

The same is true of the snapshot store, which is where states and backups live rather than the
files you browse: `TESTATE_STORE=s3` with `TESTATE_S3_ENDPOINT` points it at any of these.

## 4. How to test the connection

Before saving, click **Test connection** in the New adapter dialog. Testate opens the connection with the values in the form, reports the engine and version, whether it meets the minimum supported version, its capabilities (can it truncate, disable triggers, run inside one transaction), and any warnings. Nothing is written until you click **Create**; the test is a dry run.

A blocked or unreachable host fails here with the reason (address policy, authentication, timeout), before you commit to a broken adapter.

Once an adapter is saved, `POST /api/v1/projects/{slug}/adapters/{id}/retest` re-runs the same probe with the stored credentials. This is useful after a password rotation or a privilege change on the database side. There is no retest button in the dashboard yet; call the endpoint directly with a `qa` or `admin` token.

## 5. How to connect an AI agent to a project

Testate exposes an MCP (Model Context Protocol) endpoint. What the agent may do there is the token's role, not the protocol's: a Guest token reads and nothing else, a Tester token also changes rows in a sandbox, takes a state, and puts one back.

1. As an admin, open **Tokens** and create a token of kind **agent**. Choose a name, a role (**Guest** to read, **Tester** to write), a project scope, and when it expires: in 90 days, on a date you pick up to a year out, or never.
2. Copy the token: Testate shows it once. It reads `tst_` followed by 43 characters. Give the agent the endpoint and the token.

Claude Code:

```sh
claude mcp add --transport http testate https://testate.example.internal/api/v1/mcp --header "Authorization: Bearer tst_YOUR_TOKEN"
```

Keep the `--header` value on one line. A header value cannot contain a newline, so a line break pasted inside those quotes is refused by the client before it reaches Testate, with `Header 'Authorization' has invalid value`.

With a sub-path: `https://example.internal/testate/api/v1/mcp`.

Any MCP client:

```json
{
  "mcpServers": {
    "testate": {
      "type": "http",
      "url": "https://testate.example.internal/api/v1/mcp",
      "headers": { "Authorization": "Bearer tst_YOUR_TOKEN" }
    }
  }
}
```

What the agent can reach: an agent token is accepted only on `/api/v1/mcp`; every other route answers `403`.

Every agent reads: `help`, `list_projects`, `list_adapters`, `list_tables`, `describe_table`, `page_rows`, `get_row`, `run_readonly_query`, `extract_fixture`, `list_states`, `get_state`, `diff_summary`, `list_files`, `preview_file`. A **Tester** token gets seven more: `run_write_query`, `end_write_session`, `take_snapshot`, `checkout_state`, `get_job`, `upload_file`, `delete_file`. A Guest sees them in `tools/list` and is refused with `403 role` if it calls one, which is a clearer answer than a tool that is not there.

The caps hold whatever the role: 200 rows a page (1000 max), 1 MiB a result, 15 seconds a query, a byte budget per token. `run_readonly_query` runs inside a read-only transaction for every role, so a read never becomes a write by accident, and writing takes the write tool and a write session. Column policies mask sensitive values before the agent sees them and there is no unmask. Every call is audited with the tool name, an argument hash, the project, the adapter, and the outcome.

### When the token expires

An agent token stops working the moment it expires or an admin revokes it, and there is no refresh:
Testate issues bearer tokens, not a session the client can renew. Every call after that answers
`401` with `{"error": {"code": "UNAUTHORIZED"}}`, which an MCP client reports as a failure to
connect or a tool that will not run. Nothing warns you first, so a token set to **Never** is worth a
note wherever your team keeps its credentials: nothing else will remind you it exists.

Reconnecting is issuing a new token and giving it to the client:

```sh
claude mcp remove testate
claude mcp add --transport http testate https://testate.example.internal/api/v1/mcp --header "Authorization: Bearer tst_YOUR_NEW_TOKEN"
```

For any other client, replace the `Authorization` header in its config and restart it. Nothing on
the Testate side needs restarting, and the old token is dead the moment it expires whether or not
anyone deletes the row.

Check a token before you blame the client: `GET /api/v1/auth/me` with the same header answers `200`
with the token's role and scope while it is good, and `401` once it is not.

Full detail: [docs/AGENT_ACCESS.md](docs/AGENT_ACCESS.md).

## 6. How to integrate into a CI/CD pipeline

The full REST API is available for automation; nothing here is dashboard-only. The endpoint matrix (every resource, its operations, and their status) lives in [docs/api-specs/_index.md](docs/api-specs/_index.md), with one detail document per resource alongside it.

**Browse the API in the running instance.** Every endpoint, its parameters and its responses, with a request you can send from the page:

| Address                | What it serves                                           |
| ---------------------- | -------------------------------------------------------- |
| `/api/v1/docs`         | the reference, rendered by [Scalar](https://scalar.com)  |
| `/api/v1/openapi.json` | the same contract as OpenAPI 3.1, for a client generator |

Open <http://localhost:7378/api/v1/docs> after the quick start above. It is generated from the routes rather than written by hand, so it describes the version you are running.

Both ask who is reading. Any signed-in role may read them, because knowing the API is not a privilege here; an agent token may not, for the same reason it reaches nothing but `/mcp`. A browser with no session is sent to the sign-in screen and comes back afterwards; a client asking for JSON gets a `401`. They touch no data, but they do describe every route on a box a stranger can reach, and that is worth a session.

Health is not behind this: `/api/v1/health/live` and `/api/v1/health/ready` answer with no credential, because a liveness probe has none to give.

**Authentication.** Create a token under **Tokens** (or `POST /api/v1/tokens`, admin only) with kind `standard` and a role. `qa` can run checkouts, imports, and snapshots; `viewer` can only read. Send it as `Authorization: Bearer tst_<token>`. There is no cookie and no CSRF header to add; those apply to the dashboard's own session only.

**Example: reset the database before a test run.** `POST /projects/{slug}/checkouts` restores a named state. Story 113 in the product's own backlog calls this out as the CI entry point. `wait` blocks the request until the job finishes or the given number of seconds pass (1 to 300), but a `202` (still running) is still a successful HTTP call, and a finished job can still have `status: "failed"`. Gate the pipeline step on the job's `status`, not on the HTTP code:

```sh
JOB=$(curl -sf -X POST "$TESTATE_URL/api/v1/projects/shop/checkouts" \
  -H "Authorization: Bearer $TESTATE_TOKEN" -H "Content-Type: application/json" \
  -d '{"state_name": "seeded-baseline"}')
JOB_ID=$(echo "$JOB" | jq -r '.data.job.id')
STATUS=$(echo "$JOB" | jq -r '.data.job.status')

while [ "$STATUS" != "succeeded" ] && [ "$STATUS" != "failed" ] && [ "$STATUS" != "partial" ] \
      && [ "$STATUS" != "cancelled" ] && [ "$STATUS" != "interrupted" ]; do
  sleep 3
  STATUS=$(curl -sf "$TESTATE_URL/api/v1/jobs/$JOB_ID?wait=30" \
    -H "Authorization: Bearer $TESTATE_TOKEN" | jq -r '.data.status')
done

[ "$STATUS" = "succeeded" ] || { echo "checkout ended in status: $STATUS" >&2; exit 1; }
```

Every job-creating `POST` also accepts an `Idempotency-Key` header, so a retried CI step after a network blip does not trigger a second restore.

## What it does not do

| Limit                                                | What happens                                                                                                                                                                                                                                                          | What to do about it                                                                                                                                                                                    |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| It only resets the databases you add to it           | An untracked database is left behind by a reset, and Testate cannot warn you. It has never heard of that database. The app then reads rows that no longer match.                                                                                                      | Put every database your app writes to in one project. One snapshot covers every database in a project, and one checkout restores them all.                                                             |
| Databases go one at a time, not together             | Even in one project, Testate snapshots and restores databases one after another. Each one is correct on its own, but the set is not guaranteed to line up. One restore can fail while another succeeds.                                                               | Keep the app idle while you snapshot or reset.                                                                                                                                                         |
| It has to reach the database from inside a container | A database on another server needs a route, an open firewall, and a login. Inside the container, `127.0.0.1` means the container, not the host. If Testate cannot reach a database, you cannot add it, so a reset skips it.                                           | Point the adapter at the host or container name that is actually reachable; see section 3 above.                                                                                                       |
| A snapshot has no owner                              | Two testers sharing one database share everything: either can reset it, and the other's work goes without a warning. Two projects on one database is worse: two unrelated adapters, jobs not kept apart, each taking its own starting snapshot at a different moment. | Run one database, one project, one tester at a time. The connection test warns you when another project already tracks that database.                                                                  |
| It needs a real database connection                  | Testate has to speak the database's own protocol, read every table at one moment, and be allowed to empty and refill tables inside one transaction. Firebase, Firestore, and DynamoDB give you an SDK rather than a connection, so you cannot add them.               | Use an ordinary target instead: Supabase, Neon, RDS, and Cloud SQL all work. On Supabase, use the direct connection rather than the pooler, with a role that owns the tables, or the reset is refused. |
| It resets databases and nothing else                 | Caches, queues, and whatever a running service holds in memory stay untouched, so a service can go on serving rows the database no longer has.                                                                                                                        | Restart the service, or clear its cache, after the reset. Testate does not do it for you.                                                                                                              |

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

## Upgrading, backups, and operating it

Pulling a new image, rolling back a failed migration, scheduling backups, and rotating the sealing key are all covered in [docs/DEPLOYMENT_PLAN.md](docs/DEPLOYMENT_PLAN.md) and [docs/KEY_ROTATION.md](docs/KEY_ROTATION.md).

## Developing Testate

If you want to build or change Testate itself rather than run it, start at [CLAUDE.md](CLAUDE.md) for the commands, layout, and conventions.

To run it from source rather than from the image:

```sh
bun install
cp apps/api/.env.example apps/api/.env
bun scripts/generate-key.ts          # paste into TESTATE_SECRETS_ACTIVE_KEY
# set TESTATE_ADMIN_PASSWORD too, then:
bun run dev                          # API on :7378, web on :7379
```

The file belongs in `apps/api/`, not the repo root. Bun reads `.env` from the working directory and does not look upwards, and `bun run dev` starts the API with `apps/api` as its working directory. `deploy/.env.example` is the container's version of the same variables and is wrong for a source run: it points `TESTATE_DATA_DIR` at `/data`.

## Docs

Docs live in `docs/`: the [PRD](docs/PRD.md), the [technical specs](docs/technical-specs/_index.md), the [API specs](docs/api-specs/_index.md), [agent access](docs/AGENT_ACCESS.md), the [deployment plan](docs/DEPLOYMENT_PLAN.md), and [key rotation](docs/KEY_ROTATION.md).

## License

MIT. Copyright PT. Perkasa Pilar Utama.

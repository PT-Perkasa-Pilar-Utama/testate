# Connecting a database or a file store

Open a project, go to **Databases**, and click **New adapter**. For a database engine (PostgreSQL, MySQL, MariaDB, MongoDB) the form asks for Host, Port, Database, User, and Password. Where you point "Host" depends on where the database actually runs.

Testate connects out to the database from inside its own container. `127.0.0.1` or `localhost` in that form means the Testate container itself, never the machine it runs on. The default address deny list also blocks `127.0.0.0/8` and `::1/128` outright, so a loopback address will not connect even by accident.

## A. A database running in Docker, on the same machine as Testate

Put both containers on the same Docker network, then use the target container's name as the host and its **internal** port, not the port it publishes to the host.

```sh
docker ps --format '{{.Names}}'                        # find the two container names
docker network create testate-net
docker network connect testate-net <testate-container>       # e.g. testate-testate-1
docker network connect testate-net <your-db-container>       # e.g. shop-postgres
```

Once connected, a container's own name is its DNS name on that network. Adapter form: Host `<your-db-container>`, Port `5432` (Postgres's own port inside the container, not whatever you mapped it to on the host).

## B. A database running as a native binary on the host

Docker on Linux defines `host.docker.internal` only when you ask for it; Docker Desktop on macOS and Windows defines it always. With `docker run`, add the flag and recreate the container:

```sh
docker run -d --name testate ... --add-host=host.docker.internal:host-gateway ghcr.io/pt-perkasa-pilar-utama/testate:1.2.0
```

With compose, uncomment `extra_hosts` in `deploy/docker-compose.yml` and restart:

```yaml
services:
  testate:
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

Adapter form: Host `host.docker.internal`, Port whatever the native process listens on (`5432` for a default Postgres install).

### The database must listen beyond localhost

Every native install ships bound to `127.0.0.1`, and a database bound there answers nobody outside the machine, the container included. `extra_hosts` does not change that. Open the listener, then restart the engine:

| Engine   | File              | Change                                                                                       |
| -------- | ----------------- | -------------------------------------------------------------------------------------------- |
| Postgres | `postgresql.conf` | `listen_addresses = '*'`                                                                     |
| Postgres | `pg_hba.conf`     | add `host all all 172.16.0.0/12 scram-sha-256` (Docker and WSL subnets live in that range)   |
| MySQL    | `my.ini`, `my.cnf` | `bind-address = 0.0.0.0`; the user must exist as `'name'@'%'`, not only `'name'@'localhost'` |
| MariaDB  | same as MySQL     | same as MySQL                                                                                |
| MongoDB  | `mongod.conf`     | `net.bindIp: 0.0.0.0`                                                                        |

### Docker Engine inside WSL2, the database on Windows (Laragon, XAMPP, a plain installer)

If the probe says `host.docker.internal does not resolve`, you are not on Docker Desktop: Docker Desktop defines the name always. You are on Docker Engine installed inside WSL2, which is Linux Docker, and `host-gateway` there points at the WSL2 VM, not at Windows. A database installed by Laragon runs on Windows, so the alias needs the Windows address instead:

```sh
# inside WSL
ip route show default | awk '{print $3}'      # e.g. 172.28.16.1
```

Recreate Testate with that address in place of `host-gateway`, in `docker run`:

```sh
docker run -d --name testate ... --add-host=host.docker.internal:172.28.16.1 ghcr.io/pt-perkasa-pilar-utama/testate:1.2.0
```

or in `deploy/docker-compose.yml`:

```yaml
services:
  testate:
    extra_hosts:
      - "host.docker.internal:172.28.16.1"
```

Under WSL mirrored networking (`networkingMode=mirrored` in `.wslconfig`), use the Windows LAN address from `ipconfig` instead; the route above shows nothing useful there. The listener changes in the table apply too, and Windows Firewall must allow the port inbound from the `vEthernet (WSL)` adapter. Laragon's default database is MySQL on `3306`, not Postgres on `5432`; pick the engine you actually run.

## C. A database on another machine, or in the cloud (managed or remote)

Adapter form: Host is the machine's address or DNS name, Port its usual port. Another machine on your network is the same case as a cloud provider: the database must listen on an interface that machine exposes (a Postgres bound to `127.0.0.1` answers nobody else), and its firewall must let the port through. Nothing extra to configure on the Testate side beyond a route from the host running Testate to that address (an open firewall, a VPN, a public endpoint, whatever your provider needs).

### Supabase

Use the **Session pooler**, not the direct host. The direct host, `db.<ref>.supabase.co`, has only an IPv6 address, and a Docker container on a machine without IPv6 cannot reach it: Docker Desktop's resolver drops the answer (the probe says the name does not resolve) and Linux Docker refuses the connect. The Session pooler answers on IPv4 and takes the transaction shape a restore needs. Copy the values from the dashboard under **Connect**, "Session pooler":

| Field    | Value                                                            |
| -------- | ---------------------------------------------------------------- |
| Host     | `aws-<n>-<region>.pooler.supabase.com`, as the dashboard shows it |
| Port     | `5432`                                                           |
| User     | `postgres.<ref>`, the project ref appended, not plain `postgres` |
| Database | `postgres`                                                       |

Do not use the Transaction pooler on `6543`: it drops prepared statements and session state between queries. The direct host still works from a machine with an IPv6 route, or with Supabase's paid IPv4 add-on.

## D. An object store that is not Amazon's

There is one object-storage engine, `s3` in the API and "Object storage" on screen, and it speaks to anything that speaks S3. The **Endpoint** field
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

## E. Test the connection before you save it

Before saving, click **Test connection** in the New adapter dialog. Testate opens the connection with the values in the form, reports the engine and version, whether it meets the minimum supported version, its capabilities (can it truncate, disable triggers, run inside one transaction), and any warnings. Nothing is written until you click **Create**; the test is a dry run.

A blocked or unreachable host fails here with the reason (address policy, authentication, timeout), before you commit to a broken adapter. A name that does not resolve, or a loopback address from inside the container, fails with the way out for where Testate runs: sections A and B from a container, section F from the binary. A cloud host that resolves on your machine but not in the container is IPv6-only; see the Supabase note in section C.

Once an adapter is saved, `POST /api/v1/projects/{slug}/adapters/{id}/retest` re-runs the same probe with the stored credentials. This is useful after a password rotation or a privilege change on the database side. There is no retest button in the dashboard yet; call the endpoint directly with a `qa` or `admin` token.

## F. Testate running as the binary, the database in Docker

The single binary runs on the host itself, so there is no container to join a Docker network from and a container's name does not resolve. Point the adapter at this machine and the port the database container publishes:

```sh
docker ps --format '{{.Names}} {{.Ports}}'      # e.g. shop-postgres 0.0.0.0:15432->5432/tcp
```

Adapter form: Host this machine's own address, which the chip under the field offers, Port the published one, `15432` in that example, not the container's `5432`. `localhost` is refused by default: the deny list ships with `127.0.0.0/8` on it because loopback inside a container is Testate itself. On the binary that rule protects nothing, so an admin may remove it under **Settings**, and `localhost` works from then on.

## G. Let your app push its logs

Nothing is dialled here: your app sends its logs to Testate. Open **Logs**, click **New log adapter**, and pick "Push from your app". Testate shows the adapter's token once. Copy it then; rotate it on the adapter page if it is lost.

Send `testate`-format JSON lines, one or many per request, at most 1 MB:

```sh
curl -X POST https://testate.example.internal/api/v1/ingest/<adapter-id> \
  -H "Authorization: Bearer tsi_YOUR_TOKEN" -H "Content-Type: application/x-ndjson" \
  --data-binary $'{"level":"error","message":"refund failed","service":{"name":"billing"},"order":42}\n'
```

| Key | Meaning |
| --- | --- |
| `ts` | ISO time or epoch. Leave it out and Testate stamps the time it arrived. A time ahead of Testate's clock is clamped to it |
| `level` | `trace`, `debug`, `info`, `warn`, `error` or `fatal` |
| `message` | The line a person reads |
| `service.name` | The source it lands in; one viewer source per service. Without it, `default` |
| anything else | Kept as the entry's fields, searchable from the viewer |

The answer is `202 { "data": { "accepted": 3, "malformed": 0 } }`. `malformed` counts lines that were not JSON: they are kept as text, so a logging bug shows up there rather than as missing lines. Past 600 requests a minute you get `429` with `Retry-After`; batch lines instead. Once today's lines fill the adapter's size cap, pushes answer `507` until the next day, a clear, or a larger cap. Pushed logs are not in a backup: `testate whereis ingest` prints the folder to copy.

## H. Let Testate read a database's server logs

A database adapter's **Server logs** tab reads through the adapter's own connection, so it shows what the adapter's user may see. Each source it cannot read is listed under the viewer with what opens it. Run the grant, then **Retest connection**.

| Engine | To read its statements | To read more |
| --- | --- | --- |
| PostgreSQL | Nothing; `GRANT pg_read_all_stats TO <user>;` shows other users' statements too | `logging_collector = on` and `GRANT pg_read_server_files TO <user>;` for the server log |
| MySQL | `GRANT SELECT ON performance_schema.* TO <user>;` | `SET GLOBAL slow_query_log = ON, log_output = 'TABLE'; GRANT SELECT ON mysql.slow_log TO <user>;` |
| MariaDB | `performance_schema = ON`, `performance_schema_consumer_events_statements_current = ON` and `performance_schema_consumer_events_statements_history = ON` in the server config, then the MySQL grant | the slow log, as MySQL |
| MongoDB | Nothing for this user's own operations; `roles: ["clusterMonitor"]` for everyone's | the same role reads the server log |

On RDS, Supabase, Neon or Cloud SQL the server log file is out of reach; statements still work. To read log files on the database host itself, add a `logfile` log adapter over SFTP.

## I. Read a host's systemd journal

For services that log to journald rather than to files. Open **Logs**, click **New log adapter**, and pick "systemd journal over SSH". Give the host, the SSH user and its password, then one source per group of units: `api.service worker.service`, or nothing for the whole journal.

Testate runs one command on the host, `journalctl`, with arguments it builds itself. It never runs anything a person types.

The user needs the `systemd-journal` group to read every unit; without it, journalctl shows only that user's own lines. **Test connection** says so, with the command to run:

```sh
sudo usermod -aG systemd-journal deploy
```

The host key is trusted the first time a person reads, as for SFTP. A changed key stops every read until someone accepts the new one. A host with no journal yet, or a container without journald, gets a `no_journal` warning.

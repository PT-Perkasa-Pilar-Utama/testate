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
docker run -d --name testate ... --add-host=host.docker.internal:host-gateway ghcr.io/pt-perkasa-pilar-utama/testate:1.1.0
```

With compose, uncomment `extra_hosts` in `deploy/docker-compose.yml` and restart:

```yaml
services:
  testate:
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

Adapter form: Host `host.docker.internal`, Port whatever the native process listens on (`5432` for a default Postgres install). The database must also listen on that interface. A Postgres bound only to `127.0.0.1` in `postgresql.conf` is unreachable from the container even with `extra_hosts` set; bind it to `0.0.0.0` or the Docker bridge address instead.

## C. A database on another machine, or in the cloud (managed or remote)

Adapter form: Host is the machine's address or DNS name, Port its usual port. Another machine on your network is the same case as a cloud provider: the database must listen on an interface that machine exposes (a Postgres bound to `127.0.0.1` answers nobody else), and its firewall must let the port through. Nothing extra to configure on the Testate side beyond a route from the host running Testate to that address (an open firewall, a VPN, a public endpoint, whatever your provider needs).

On Supabase specifically, use the direct connection string, not the pooler, and a role that owns the tables. The pooler refuses the transaction shape a restore needs.

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

A blocked or unreachable host fails here with the reason (address policy, authentication, timeout), before you commit to a broken adapter. A name that does not resolve, or a loopback address from inside the container, fails with the way out for where Testate runs: sections A and B from a container, section F from the binary.

Once an adapter is saved, `POST /api/v1/projects/{slug}/adapters/{id}/retest` re-runs the same probe with the stored credentials. This is useful after a password rotation or a privilege change on the database side. There is no retest button in the dashboard yet; call the endpoint directly with a `qa` or `admin` token.

## F. Testate running as the binary, the database in Docker

The single binary runs on the host itself, so there is no container to join a Docker network from and a container's name does not resolve. Point the adapter at this machine and the port the database container publishes:

```sh
docker ps --format '{{.Names}} {{.Ports}}'      # e.g. shop-postgres 0.0.0.0:15432->5432/tcp
```

Adapter form: Host this machine's own address, which the chip under the field offers, Port the published one, `15432` in that example, not the container's `5432`. `localhost` is refused by default: the deny list ships with `127.0.0.0/8` on it because loopback inside a container is Testate itself. On the binary that rule protects nothing, so an admin may remove it under **Settings**, and `localhost` works from then on.

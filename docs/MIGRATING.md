# Upgrade from 1.x to 2.0.0

Two ways forward, and both keep everything: projects, states, accounts, tokens, and the
stored credentials.

| Path | Choose it when |
| --- | --- |
| [A. Stay on Docker](#a-stay-on-docker) | You want the same setup on a newer image |
| [B. Move to the binary](#b-move-to-the-binary) | You want Testate as a service on the host, with no container |

Both were walked from a 1.x container with a project, a token and sealed credentials in it. The
upgrade applied migrations 0009 to 0013, the old password and the old token still worked, and no
sealed value was unreadable. Path B also left the old container runnable for a rollback.

## Before you start

### 1. Read what breaks

| Change | Do this before you upgrade |
| --- | --- |
| The first boot runs the retention sweep, which never ran in 1.x, and deletes old rows | Check the retention settings ([step 2](#2-check-the-retention-settings)) |
| `POST /tokens` needs `project_ids` | Change any script that creates tokens: send a list of project IDs, or `null` for every project |
| Release archives are named `testate_<os>_<arch>.tar.gz` | Change any script that downloads a release by name |
| The binary reads no `.env` beside it | Use `~/.config/testate/testate.env`, or pass `--env-file` |
| `inspect` is a reserved project slug | Nothing: a project already named `inspect` keeps its slug, and the built-in Inspect project takes `inspect-2` |
| The project page has no Databases tab | Update bookmarks to the Databases menu; `?tab=adapters` redirects there |

Every viewer and tester who exists before the upgrade keeps access to every project. Limit that
afterwards under **Users** if you want to.

### 2. Check the retention settings

The first boot deletes what is past these limits. Open **Settings** and read them before you
upgrade. Raise a limit there first if you want to keep more.

| Setting | Default | The first boot deletes |
| --- | --- | --- |
| Stashes to keep | 5 | the oldest stashes past this count |
| Audit log (days) | 365 | older audit rows |
| Audit request and response bodies (days) | 30 | older stored request bodies |
| Query history (days) | 90 | older query history |
| Import run history (days) | 30 | older import runs |

Expired download backups go too.

### 3. Back up, and keep the key

1. Under **Settings → Backup**, turn on **Include snapshot blobs**, choose **Run backup**, then
   **Download backup**.
2. Save the sealing key to a file outside the container. Without it, the stored credentials
   cannot be read:

   ```sh
   (umask 077; docker inspect testate --format '{{range .Config.Env}}{{println .}}{{end}}' \
     | grep '^TESTATE_SECRETS_ACTIVE_KEY=' > testate-key.txt)
   ```

The commands here assume the container is named `testate` and the volume `testate-data`. Use
your own names.

## A. Stay on Docker

A container is bound to its image, so you replace the container. The volume and the key carry over.

```sh
docker pull ghcr.io/pt-perkasa-pilar-utama/testate:2.0.0
docker stop testate
docker rm testate
docker run -d --name testate -p 7378:7378 -v testate-data:/data \
  -e TESTATE_SECRETS_ACTIVE_KEY="$(cut -d= -f2- testate-key.txt)" \
  ghcr.io/pt-perkasa-pilar-utama/testate:2.0.0
docker network connect testate-net testate   # if the databases are reached over a Docker network
```

Keep the same volume, the same key and the same extra flags (`--add-host`, `-e TESTATE_PUBLIC_URL`,
and the rest). Leave `TESTATE_ADMIN_PASSWORD` out: the accounts already exist.

With Compose, set the image tag to `2.0.0`, then run `docker compose pull` and
`docker compose up -d`.

Check it:

```sh
curl -s -o /dev/null -w '%{http_code}\n' localhost:7378/api/v1/health/ready   # 204
```

Then sign in. The sidebar shows Databases, Storage and Logs.

## B. Move to the binary

The container's data moves to the host, and the binary runs it with the same key. The container
and its volume stay as they are until you remove them, so going back takes one command.

### 1. Install the binary

```sh
curl -fsSL https://pt-perkasa-pilar-utama.github.io/testate/install.sh | sh
```

Do not run `testate setup` yet. Step 3 writes its file from the container's own settings.

### 2. Stop the container and copy its data

```sh
docker stop testate
mkdir -p ~/.local/share/testate
docker cp testate:/data/. ~/.local/share/testate/
```

Stop it first: the copy must not catch the database mid-write. `docker cp` copies the files
as your own user. If the snapshots live in S3 (`TESTATE_STORE=s3`), they stay there, and step 3
carries the settings that reach them.

### 3. Write the env file from the container

```sh
mkdir -p ~/.config/testate
(
  umask 077
  docker inspect testate --format '{{range .Config.Env}}{{println .}}{{end}}' \
    | grep -E '^(TESTATE_|PORT=)' \
    | grep -vE '^TESTATE_(DATA_DIR|ADMIN_PASSWORD)=' \
    > ~/.config/testate/testate.env
  echo "TESTATE_DATA_DIR=$HOME/.local/share/testate" >> ~/.config/testate/testate.env
)
```

The file now holds the container's key, its port and every other `TESTATE_` setting it ran with,
and points at the copied data. Back this file up: it holds the key.

### 4. Start it

Run it in the foreground once, to watch the first boot apply the migrations:

```sh
testate
```

Open `localhost:7378` and sign in with your usual password. Stop it with Ctrl-C, then install the
service:

```sh
testate service install
testate service status
```

On a Linux server nobody logs in to, a per-user service starts at boot only with lingering on. Run
`sudo loginctl enable-linger $USER` once; `testate service install` says so when it cannot do it
itself. A system-wide systemd unit is the other way, in [Install](INSTALL.md#other-ways-to-run-it).

### 5. Point the adapters at their databases again

Inside the container, an adapter reached a database by its container name on a Docker network, or
through `host.docker.internal`. On the host neither name resolves. Each such adapter needs a new
host and port:

```sh
docker ps --format '{{.Names}} {{.Ports}}'   # e.g. shop-postgres 0.0.0.0:15432->5432/tcp
```

| The adapter pointed at | Change it to |
| --- | --- |
| A container name, such as `shop-postgres:5432` | This machine's address, with the port the container publishes (`15432` above) |
| `host.docker.internal` | This machine's address, with the same port |
| Another machine's address | Nothing |

Open each adapter, choose **Edit adapter**, change the host and the port, and save. The connection test
runs on save. Its states stay, because the database behind it is the same one.

`localhost` is refused by default: the deny list holds `127.0.0.0/8`, because inside a container
loopback is Testate itself. On the binary that rule protects nothing. Remove it under
**Settings**, and `localhost` with the published port works.

A database container that publishes no port cannot be reached from the host. Publish one
(`-p 15432:5432`), or keep Testate on Docker for that stack.

### 6. Remove the container

Once everything answers, remove the container. Keep the volume a while longer as your copy:

```sh
docker rm testate
docker volume rm testate-data   # later, once you no longer need the way back
```

## If something goes wrong

| What happened | Do this |
| --- | --- |
| Path A: a migration failed on boot | Boot keeps a copy of the database from before the migrations, in `run/metadata-<boot_id>.db` on the volume. Stop the container, copy that file over `metadata.db`, and run the 1.x image again |
| Path B: the binary will not start, or something is missing | `testate service stop`, then `docker start testate`. The container's volume was never touched |
| The stored credentials cannot be read | The key is not the one the data was sealed with. Use the key from step 3 of "Before you start" |
| An adapter shows unreachable after path B | Step 5: its host is still a container name or `host.docker.internal` |

Backups and key rotation: [Deployment plan](DEPLOYMENT_PLAN.md) and [Key rotation](KEY_ROTATION.md).
Everything else that changed: [CHANGELOG](../CHANGELOG.md).

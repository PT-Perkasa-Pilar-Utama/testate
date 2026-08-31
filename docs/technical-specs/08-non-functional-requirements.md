# 8. Non-Functional Requirements

Numbers here are targets. Sprint 0 measures the engine numbers and records the results in [12-engine-port.md](12-engine-port.md) §12.7.

## 8.1 Volume

| Item | Target | Source |
| --- | --- | --- |
| Users per instance | up to 100 accounts, 30 active per day | PRD §4.18 user base |
| Projects | up to 50 | Estimate for one organization |
| Adapters per project | up to 10 | PRD multi-adapter states |
| Database size per adapter | design target 5 GB and 500 tables; larger works, slower | PRD §4.18 |
| States per project | hundreds; deduplicated storage keeps growth to changed tables | PRD §4.4 |
| Snapshot store | tens to hundreds of GB; instance ceiling setting | PRD story 14 |
| Concurrent jobs | 2 per instance by default, configurable | PRD §4.18 |
| Audit rows | 365 days by default | Settings |

## 8.2 Latency and throughput

| Path | Target | Source |
| --- | --- | --- |
| Dashboard list and detail | p95 300 ms with the metadata database on local disk, measured under concurrent job writes | PRD §4.18 |
| Grid page (keyset) | p95 500 ms for 200 rows on a table with a primary key, engine on the same intranet | Estimate |
| Query runner | bounded by the caller's time budget; default 30 s, max 300 s | PRD §4.6 |
| Snapshot | measured in Sprint 0 per engine; target 20 MB/s of gzip output on Postgres over a 1 GbE link | Spike target |
| Restore, Postgres | measured in Sprint 0; batched inserts, no bulk copy; target 30 000 rows/s on a 10-column table | Spike target |
| Restore, MySQL and MariaDB | measured in Sprint 0; multi-row inserts under `max_allowed_packet` | Spike target |
| Restore, MongoDB | measured in Sprint 0; `insertMany` unordered in 1 000-document batches | Spike target |
| Diff | streaming merge; memory bounded by one chunk per side per table | Design |
| Job pickup | queued to running within 1 s when a slot is free | Dispatcher tick 500 ms |
| SSE progress | at most one event per 250 ms per job | Batching rule |
| `wait` | up to 300 s; nginx read timeout 330 s | PRD §4.10 |

## 8.3 Availability and durability

| Item | Target |
| --- | --- |
| Availability | Single instance; restarts in under 10 s; no cluster mode; planned downtime for upgrades |
| Job durability | Queue persisted in SQLite; interrupted jobs are marked, never silently retried |
| Data durability | Metadata: WAL with `synchronous=NORMAL`, pre-migration copies of the last three boots. Blobs: written to a temp name and renamed after the hash check; S3 put verified by ETag or size |
| Backup | Admin backup job; operator volume snapshot documented in the deployment plan |
| Recovery | Boot recovery marks interrupted jobs and HEAD unknown; declared-loss mode for lost keys |

## 8.4 Resource limits

| Resource | Limit |
| --- | --- |
| Memory | Snapshot and restore stream chunk by chunk: at most 2 chunks (default 5 000 rows) in memory per table per job; query results bounded by row cap and byte budget; container limit 1 GiB recommended, 2 GiB with two concurrent large restores |
| CPU | One Bun process; gzip and hashing are the main CPU cost; two cores recommended |
| Disk | Blobs, logs (30 days), uploads (deleted after the job), import artifacts (30 days), run files (last three boots) |
| Connections to targets | Pool per adapter: 4 connections default; snapshot and restore reserve 1 each; cancel uses a short-lived extra connection |
| File descriptors | Under 1 024 with the defaults |

## 8.5 Compatibility

| Item | Floor |
| --- | --- |
| Postgres | 13 |
| MySQL | 8.0 |
| MariaDB | 10.6 |
| MongoDB | 6.0; time-series deletes 7.0 (probe-gated) |
| S3 | AWS S3 and S3-compatible endpoints with ListObjectsV2 |
| SFTP | SSH-2 servers with `ssh-ed25519`, `ecdsa-sha2-nistp256`, or `rsa-sha2-256` host keys |
| FTP | Plain FTP and explicit TLS (`AUTH TLS`) |
| Browsers | Current Chrome, Firefox, Safari; desktop first, usable to 768 px wide |
| Proxy | Any reverse proxy forwarding `X-Forwarded-Proto` and `X-Forwarded-For`; nginx example shipped |

## 8.6 Observability

| Item | Requirement |
| --- | --- |
| Logs | One wide event per request and per job to `${TESTATE_DATA_DIR}/logs`, 30-day retention, stdout mirror; see 21 |
| Health | `/health`, `/health/live`, `/health/ready` per 05 §5.15 |
| Audit | Every listed action in `audit_logs` with actor and outcome |
| Metrics | None in scope (PRD §6) |

## 8.7 Security baselines

| Item | Requirement |
| --- | --- |
| Transport | HTTPS at the proxy; cookies `Secure` when the proxy reports HTTPS |
| Secrets at rest | Sealed values only; keys outside the volume |
| Dependencies | No scan in CI yet. When one lands, a high-severity finding blocks release |
| Supply chain | Exact pins; `bun install --frozen-lockfile` in CI and the image build |

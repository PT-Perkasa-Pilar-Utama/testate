# 10. Integration Points

Every external system Testate talks to, with its contract, failure mode, and fallback. All outbound connections pass the address policy in [18-outbound-address-policy.md](18-outbound-address-policy.md).

## 10.1 Target databases

| Engine | Driver | Contract | Failure modes | Fallback |
| --- | --- | --- | --- | --- |
| Postgres 13+ | `Bun.SQL` (`postgres://`), TLS modes `disable` to `verify-full` | `DbEngine` per ADR 0001: probe, introspect, snapshot (repeatable-read + cursor), checkout, query, write; see 12 | Unreachable, auth, version below floor, privilege missing, lock timeout, cancel | Dependency-ordered inserts when trigger disable is unavailable; `DELETE` for tables referenced from outside the plan |
| MySQL 8.0+ | `Bun.SQL` (`mysql://`), `caching_sha2_password` over TLS or with public key retrieval enabled explicitly | Same port; consistent-snapshot transaction with keyset chunks; `max_execution_time` in ms | Same, plus implicit commits on `TRUNCATE` and `ALTER` | Atomic mode with `DELETE` by default; fast mode only with `DROP` |
| MariaDB 10.6+ | `Bun.SQL` mysql adapter with dialect branches; `mysql2` if the Sprint 0 spike fails | Same; `max_statement_time` in seconds | Same | `mysql2` for both MySQL and MariaDB |
| MongoDB 6.0+ | `mongodb` 7.6.0 | Same port; snapshot read concern on replica sets; canonical Extended JSON; `killOp` | Standalone (best effort), 16 MB document limit, time-series restrictions, no session read-only flag | Read-role credential or operation filter; `deleteMany` then `insertMany` |

Connection pool: one per adapter, keyed by adapter id, four connections, idle close after ten minutes, evicted on target change or credential replacement.

## 10.2 Snapshot store

| Driver | Contract | Failure modes | Fallback |
| --- | --- | --- | --- |
| Local | `${TESTATE_DATA_DIR}/blobs/<aa>/<hash>`; write to `<hash>.tmp`, fsync, rename | Disk full, permission | Quota and instance ceiling refuse new states before the disk fills; health reports free bytes |
| S3 | `Bun.S3Client` with bucket, prefix, region, optional endpoint, virtual-hosted flag; `put` with size check, `get` streaming, `list` paginated, `delete` | Unreachable, auth, throttling | Retries with backoff on 5xx and throttling (3 attempts); job fails otherwise; health reports the store |

A store switch runs the migration job (copy every referenced blob, verify, then flip) and is refused while jobs run.

## 10.3 Storage adapters

| Protocol | Library | Contract | Failure modes | Fallback |
| --- | --- | --- | --- | --- |
| S3 and compatible | `Bun.S3Client` | `list(prefix, cursor)`, `stat(key)`, `read(key)` streaming; virtual-hosted or path style | Auth, bucket policy, throttling | Error surfaced as `ADAPTER_UNREACHABLE` with the S3 error code in details |
| SFTP | `ssh2` 1.17.0 + `ssh2-sftp-client` 11.x with the Simulflow `bun patch` (pure-JS crypto) | `list(path)`, `stat(path)`, `read(path)` streaming; password or private key; host key trust on first use, block on change | Host key changed, auth, crash of the native addon (prevented by the patch) | Pure-JavaScript SSH implementation if the spike fails |
| FTP and FTPS | `basic-ftp` 6.2.1 | `list`, `size` + `lastMod`, `downloadTo` stream; explicit TLS optional | Passive-mode firewalls, TLS reuse quirks | Documented as passive only; an alternative pure-JS client if the spike fails |

Previews stream through Testate with a 5 MB cap; the browser never receives storage credentials.

## 10.4 Reverse proxy

| Header | Direction | Use |
| --- | --- | --- |
| `X-Forwarded-Proto` | in | `Secure` cookies and absolute URLs when `TESTATE_TRUST_PROXY=true` |
| `X-Forwarded-For` | in | `client_ip` in wide events and audit rows (first address) |
| `X-Request-Id` | in and out | Correlation; generated when absent |
| `Cache-Control: no-store` | out | API responses |

The nginx example sets `client_max_body_size` to the upload limit plus headroom, `proxy_read_timeout 330s` for `wait` and SSE, `proxy_buffering off` for `/api/v1/jobs/*/events`, and forwards the headers above.

## 10.5 Browser

The SPA talks only to `/api/v1` on its own origin with cookies. It opens one `EventSource` per watched job. It never receives credentials, connection strings, or raw driver errors.

## 10.6 CI matrix services

`deploy/compose.engines.yml` runs: Postgres 13 and 17, MySQL 8.0 and 8.4, MariaDB 10.6 and 11.4, MongoDB 6.0 and 8.0 (replica set of one for snapshot reads), MinIO, an OpenSSH SFTP container, and a vsftpd container. The contract suites run against each service through the ports only; no service is mocked.

## 10.7 What this does not do

- No calls to the application under test. Testate never talks to the system it snapshots: no saved HTTP requests, no webhooks, nothing fires before or after a checkout, a snapshot, or an import.
- No `rest` adapter kind and no `http` engine; an adapter is `database` or `storage` only, targeting Postgres, MySQL, MariaDB, MongoDB, S3, SFTP, or FTP.

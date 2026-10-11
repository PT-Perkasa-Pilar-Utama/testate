# 26. Resource readings

A resource reading is one point-in-time reading of what the hosts and database servers behind a project were doing (#38). It is not a time series. Decisions: [`../decisions/2026-10-11-resource-readings.md`](../decisions/2026-10-11-resource-readings.md).

## 26.1 Decision matrix

| Concern | Decision |
| --- | --- |
| Unit | One reading per project: every adapter that can be read, at one moment, stored as one row (06 §6.6) |
| Sources | Database adapters (Postgres, MySQL, MariaDB, MongoDB) answer their server's counters through `readResources` on the engine port (12 §12.2). `sftp` storage adapters and `logfile` adapters on the SFTP transport answer their host's. FTP, S3 and the other log engines are never read |
| Host reads | Four fixed files by absolute path, whatever the adapter's root: `/proc/loadavg`, `/proc/meminfo`, `/proc/uptime`, `/proc/stat`; and `statvfs` (the OpenSSH extension) on the adapter's root. No command runs on the host |
| Trust | Database adapters open through their engine, SFTP logins through the files resolver: netguard, sealed secrets and host-key trust apply as when browsing (05 §5.11). A token never trusts a first-seen host key |
| Request | Synchronous. The adapters read in parallel, each under a 15 s timeout |
| Failure | A value the source does not hold, or a grant the login lacks, is unavailable with the reason. An adapter that cannot be reached at all is one unavailable key, `adapter`, with the cause. The reading always saves |
| Retention | Swept with the job history, after `retention.job_history_days` (16 §16.1) |
| Roles | Viewers read; testers and admins take. Readings work in every project, Inspect included: they write nothing to a target |
| Out of scope | Time series, graphs over time, sample retention, alerts, dashboards, tracing. The answer for those is Prometheus and Grafana (01 §1.2.18) |

## 26.2 Values

Each value is `{ key, value, unit }`, with `unit` one of `count`, `bytes`, `seconds`, `ratio` and `load`. Keys are stable, so two readings compare key by key.

| Source | Keys | From |
| --- | --- | --- |
| Host | `load_1m`, `load_5m`, `load_15m` | `/proc/loadavg` |
| Host | `cpu_count` | the `cpuN` lines of `/proc/stat`; no percentage, which needs two reads |
| Host | `memory_total`, `memory_available`, `swap_total`, `swap_free` | `/proc/meminfo` (`MemAvailable` needs Linux 3.14) |
| Host | `uptime` | `/proc/uptime` |
| Host | `disk_total`, `disk_free` | `statvfs` of the adapter's root: blocks and available blocks times the fragment size |
| Postgres | `connections`, `max_connections`, `active_connections` | `pg_stat_activity`; `active_connections` needs `pg_read_all_stats` or a superuser, since other sessions' state is hidden otherwise |
| Postgres | `database_size`, `commits`, `rollbacks`, `deadlocks`, `cache_hit_ratio`, `uptime` | `pg_stat_database` for the current database, `pg_database_size`, `pg_postmaster_start_time` |
| MySQL, MariaDB | `connections`, `active_connections`, `max_used_connections`, `questions`, `slow_queries`, `uptime` | `SHOW GLOBAL STATUS` |
| MySQL, MariaDB | `max_connections`, `database_size` | `@@max_connections`; `information_schema.tables` for the adapter's database, 0 when it holds no table |
| MongoDB | `collections`, `documents`, `data_size`, `storage_size`, `index_size` | `dbStats` |
| MongoDB | `connections`, `available_connections`, `active_connections`, `resident_memory`, `uptime` | `serverStatus`, which needs `clusterMonitor` |

Every `/proc` line and every row parses with valibot. A line that does not parse makes its own keys unavailable and nothing else.

## 26.3 Comparing two

The SPA compares two readings it already holds: per adapter and key, the older value, the newer value and the change in the value's own unit. A key one side lacks shows as not read on that side, never as zero.

## 26.4 Logging

One wide event per reading, on the request: `reading_adapters`, `reading_values`, `reading_unavailable`, `reading_ms`. No value is logged.

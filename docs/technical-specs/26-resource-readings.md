# 26. Resource readings and the monitor

A resource reading is one reading of what the hosts, the pm2 apps and the database servers behind a project were doing at a moment (#38). The monitor takes one per project on an interval and draws them as graphs over time (#101). Decisions: [`../decisions/2026-10-11-resource-readings.md`](../decisions/2026-10-11-resource-readings.md) and [`../decisions/2026-10-11-monitor.md`](../decisions/2026-10-11-monitor.md).

## 26.1 Decision matrix

| Concern | Decision |
| --- | --- |
| Unit | One reading per project: every adapter that can be read, at one moment, stored as one row (06 §6.6) |
| Sources | Database adapters (Postgres, MySQL, MariaDB, MongoDB) answer their server's counters through `readResources` on the engine port (12 §12.2). `sftp` storage adapters and `logfile` adapters on the SFTP transport answer their host's. FTP, S3 and the other log engines are never read |
| Host reads | Fixed files by absolute path, whatever the adapter's root: `/proc/loadavg`, `/proc/meminfo`, `/proc/uptime`, `/proc/stat`, `/proc/net/dev`; pm2's pid files under the login's `~/.pm2/pids`, and `/proc/<pid>/stat` and `/proc/<pid>/status` for each; and `statvfs` (the OpenSSH extension) on the adapter's root. No command runs on the host |
| Rates | CPU %, I/O wait, network throughput and each app's CPU come from two reads of the counters about a second apart, inside one reading. Elapsed time is the kernel's CPU tick total over the CPU count, not the wall clock |
| Trust | Database adapters open through their engine, SFTP logins through the files resolver: netguard, sealed secrets and host-key trust apply as when browsing (05 §5.11). A token never trusts a first-seen host key |
| Request | Synchronous. The adapters read in parallel, each under a 15 s timeout |
| Polling | A poller takes a reading of every project with a readable adapter every `limits.monitor_interval_seconds` (default 30; 0 pauses it), as Testate (`actor.kind: system`, `source: poll`). The next tick is set when one ends, so ticks never overlap. Polled readings write no audit row |
| Kept logins | The poller keeps each host's SFTP login open across ticks, so a host sees one SSH login, not one per tick. It closes a login whose adapter changed or is gone, one that read nothing at all, and every login at shutdown. It never trusts a first-seen host key; a person's reading or browse does |
| Failure | A value the source does not hold, or a grant the login lacks, is unavailable with the reason. An adapter that cannot be reached at all is one unavailable key, `adapter`, with the cause. The reading always saves |
| Retention | Manual readings after `retention.job_history_days`; polled ones after `retention.monitor_days` (default 7) (16 §16.1) |
| Roles | Viewers read and see the graphs; testers and admins take a sample by hand. Readings work in every project, Inspect included: they write nothing to a target |
| Out of scope | Alerts and thresholds, saved or custom dashboards, Docker container stats, Prometheus queries, tracing. The answer for those is Prometheus and Grafana (01 §1.2.18) |

## 26.2 Values

Each value is `{ key, value, unit }`, with `unit` one of `count`, `bytes`, `seconds`, `ratio`, `load`, `percent` and `bytes_per_second`. Keys are stable, so the series lines them up across readings.

| Source | Keys | From |
| --- | --- | --- |
| Host | `load_1m`, `load_5m`, `load_15m` | `/proc/loadavg` |
| Host | `cpu_count` | the `cpuN` lines of `/proc/stat` |
| Host | `cpu_percent`, `cpu_iowait` | the `cpu` line of `/proc/stat`, read twice: busy and iowait ticks over all ticks between the reads |
| Host | `net_rx`, `net_tx` | `/proc/net/dev`, read twice: bytes per second over every interface but `lo` |
| Host | `app_<name>_cpu`, `app_<name>_memory`, `app_<name>_uptime` | each `~/.pm2/pids/<name>.pid`, then `/proc/<pid>/stat` read twice (CPU % of one core, at 100 ticks a second) and `/proc/<pid>/status` (`VmRSS`). `/proc` holds no restart count; a restart shows as the uptime dropping. A pid that is not running makes the app's three keys unavailable. A login without `~/.pm2/pids` has no apps and no gap |
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

## 26.3 The series and the graphs

`GET /projects/{slug}/readings/series` buckets every value in a window: per adapter and key, the lowest, the mean and the highest sample in each step. SQLite opens the JSON bodies with `json_each`, so the browser never loads raw rows. A window holds at most 1000 steps.

The project's **Monitor** tab draws the means: per host CPU with I/O wait, load, memory used against the total, disk used against the total, the network, and each pm2 app's CPU and memory; per database server each value that moves, with running totals (commits, rollbacks, statements) as rates per second. A value fixed for the life of the host or server is not a graph. Windows are 15 min, 1 h, 6 h, 24 h and 7 days, and the tab asks again every 30 s. The **Monitor** menu lists every host and server across the caller's projects from each project's newest reading. The graphs are hand-drawn SVG on two colour tokens validated as a pair in both themes; no chart dependency.

## 26.4 Logging

One wide event per reading taken by hand, on the request: `reading_adapters`, `reading_values`, `reading_unavailable`, `reading_ms`. One job event per poller tick that read something: `op.name: monitor`, the projects, how many were polled, the values and gaps, the failed projects with their reasons, and the duration. A tick with nothing to read writes nothing. No value is logged.

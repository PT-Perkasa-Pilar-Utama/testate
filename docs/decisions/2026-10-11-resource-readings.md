# Resource readings (#38): decisions

Date: 2026-10-11

Every question below was decided by the advisor at the user's request.

Q8, Q10 and Q13 are superseded by the monitor (#101, [2026-10-11-monitor.md](2026-10-11-monitor.md)):
Testate now polls, keeps samples and draws graphs, and reads CPU % from two reads.

## What was measured first

| Check                                                    | Result                                                                                                                                                                            |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SFTP reads `/proc` files to the end, though they stat as size 0 | Yes. Over OpenSSH on the Colima VM, through `ssh2-sftp-client` 12.1.1: `/proc/loadavg` 29 bytes, `/proc/meminfo` 1504, `/proc/stat` 553, `/proc/uptime` 21, whole or ranged alike |
| The SFTP library exposes `statvfs`                       | Yes. `ext_openssh_statvfs("/")` answered `f_frsize`, `f_blocks`, `f_bavail` on the same host                                                                                       |
| Postgres stats as a plain login role                     | `pg_stat_database` for the current database, a count over `pg_stat_activity`, `pg_database_size`, `max_connections` and `pg_postmaster_start_time` all answer. Other sessions' detail needs `pg_read_all_stats` |
| MySQL 8.4 and MariaDB 11.4 stats as the plain test user  | `SHOW GLOBAL STATUS` (threads, uptime, questions, slow queries) and `@@max_connections` answer                                                                                     |
| MongoDB 7 stats as a `readWrite` user                    | `dbStats` answers; `serverStatus` is refused without `clusterMonitor`                                                                                                            |

## Decisions

| #   | Question                                   | Decision                                                                                                                                                                                                                  | Why                                                                                                                                                         |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | The word                                   | **Reading**: "resource reading" in prose, "Reading" in the UI, `readings` in routes and the table                                                                                                                         | The glossary defines a State as "a data-only snapshot", and the main button says Snapshot. A second snapshot would mean two things                         |
| Q2  | The unit                                   | One reading per project: every adapter that can be read, at one moment, stored as one row                                                                                                                                 | It mirrors a State, and comparing two only means something across the project                                                                              |
| Q3  | Which adapters                             | Database adapters (Postgres, MySQL, MariaDB, MongoDB) for the server; `sftp` storage adapters and `logfile` adapters on the SFTP transport for the host. FTP, S3 and the other log engines are never read                  | The engine decides it. No probe flag: a reading that cannot get a value says so per value, so nothing has to be known in advance                            |
| Q4  | `/proc` outside the adapter's root         | A fixed list, read by its own method and never through `readRange`: `/proc/loadavg`, `/proc/meminfo`, `/proc/uptime`, `/proc/stat` (CPU count only). Disk is `statvfs` of the adapter's root path                        | Four read-only files that hold no secret. The disk reading is the disk the adapter's files live on                                                          |
| Q5  | A job or a request                         | One synchronous request. The adapters read in parallel, each under its own timeout. A timeout or a refusal makes that adapter's values unavailable; the reading still saves                                                 | A few queries per adapter. A job would add progress and a stream for nothing                                                                               |
| Q6  | What is stored                             | Migration 0013, `resource_readings`: the project, the actor as an audit row stores it, the time, and a JSON body. The body lists each adapter with its values (`key`, `value`, `unit`) and what was unavailable (`key`, `reason`) | One shape for every source makes the comparison one function                                                                                                |
| Q7  | Routes                                     | `POST /projects/{slug}/readings` (qa, 201), `GET /projects/{slug}/readings` (viewer), `GET /projects/{slug}/readings/{id}` (viewer). Two readings compare in the SPA                                                         | No compare endpoint: the SPA already holds both                                                                                                             |
| Q8  | Where in the UI                            | A third tab on the project page, Readings: newest first, Take reading (qa), and two picked readings side by side with the change per value                                                                                | States and Activity already live there                                                                                                                      |
| Q9  | Retention                                  | `job_history_days`, swept with the jobs                                                                                                                                                                                   | The issue asked for the jobs' retention, and no new setting is needed                                                                                      |
| Q10 | CPU                                        | The load averages and the CPU count, one read. No CPU percentage                                                                                                                                                           | A percentage needs two reads some time apart. The load against the CPU count answers "was the CPU pinned"                                                   |
| Q11 | A value the credential may not read        | Unavailable, with the grant that opens it: `pg_read_all_stats` on Postgres, `clusterMonitor` on MongoDB                                                                                                                   | As #84 does for server logs                                                                                                                                 |
| Q12 | A fixture for the host source              | None in the compose file. The host reader runs against a memory fake in unit tests; the measurements above are the hand check                                                                                             | `atmoz/sftp` chroots its users, so `/proc` is not visible through it; the local image is also amd64 only and will not start on an arm64 Mac. A new image is the user's call while the Colima disk is at 90%                   |
| Q13 | Scope line                                 | Spec 01 §1.2.18 and PRD §6 move point-in-time readings into scope. Time series, graphs, sample retention, alerts, dashboards and tracing stay out; the answer for those is Prometheus and Grafana                          | The issue's scope gate                                                                                                                                       |
| Q14 | Readings in the Inspect project | Allowed, in every project | A reading writes nothing to a target; Inspect refuses what writes. Decided during the build |

## Deferred

| Branch                                          | Reason                                                       | Who decides |
| ----------------------------------------------- | ------------------------------------------------------------ | ----------- |
| pm2 apps (`~/.pm2/pids`, `/proc/<pid>`)          | After host and database readings, per the issue's order      | Tech Lead   |
| Docker container stats                          | Same                                                         | Tech Lead   |
| Prometheus instant queries                      | Same                                                         | Tech Lead   |
| A reading taken on its own at checkout or job start | On demand first; it is one setting later                  | Tech Lead   |
| An MCP tool for readings                        | No agent use case named yet                                  | Tech Lead   |
| A two-read CPU percentage                       | Q10                                                          | Tech Lead   |
| A compose SFTP fixture with a readable `/proc`  | Q12                                                          | The user    |

## Docs changed

- docs/GLOSSARY.md: **Resource reading** added.

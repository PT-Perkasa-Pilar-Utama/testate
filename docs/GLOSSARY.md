# Glossary

Terms as the code, the API, and the UI use them. One meaning each. Specs cite this file.

| Term | Meaning | Not |
| --- | --- | --- |
| **Project** | The unit of ownership: a slug, a set of adapters, a set of states, one HEAD, one quota | A Testate deployment |
| **Inspect project** | The one built-in project, slug `inspect`, for reading databases and files, including by agents. It holds adapters only, every one read-only: no states, no checkouts, no imports. It cannot be renamed or deleted | A debug sandbox; a project someone made read-only |
| **Adapter** | A connection Testate owns to one target: a database, a file store, or a log adapter | The engine driver code |
| **Log adapter** | An adapter of kind `logs`, always read-only. A `logfile` log adapter is one SFTP or S3 connection holding named sources; a `journald` log adapter is one SSH login to a Linux host, reading its systemd journal; a `docker` log adapter reaches a Docker daemon over SSH or TCP and reads its containers' logs; a `loki` log adapter runs LogQL log queries on a Loki or Grafana Cloud instance; an `elasticsearch` log adapter searches index patterns on an Elasticsearch or OpenSearch cluster; an `ingest` log adapter stores what an app pushes to it | A log line; a source |
| **Source** | One named stream of entries on a log adapter. On `logfile`, a file pattern in one folder, a format, and its own masking patterns; on `journald`, a group of systemd units, or the whole journal; on `docker`, one container by name; on `loki`, one LogQL log query; on `elasticsearch`, index patterns and a Lucene query; on `ingest`, the `service.name` the pushed lines carry; on a database adapter, its "Statements" or its "Server log". The viewer and `read_logs` read one source at a time | A log adapter; a data source |
| **Ingest token** | The write-only secret of one `ingest` adapter, shown once and rotated on its page. It can push lines to that adapter and nothing else | An API token; an agent token |
| **Adapter mode** | `sandbox` allows checkout, import, and writes; `read_only` refuses every write | A role |
| **Engine** | The target technology behind an adapter: `postgres`, `mysql`, `mariadb`, `mongodb`, `s3`, `sftp`, `ftp`, `logfile`, `ingest`, `journald`, `docker`, `loki`, `elasticsearch`. `s3` is a protocol rather than a vendor: the endpoint decides whether it reaches Amazon, R2, Google Cloud Storage, B2 or a MinIO on the next rack | A version |
| **Tier** | What an engine supports: **Tabular** (view, state, diff, extract, edit, import), **Document** (view, state, diff, extract), **Files** (view, download), **Logs** (read, follow, download). Each tier's adapters are listed in one sidebar menu, across projects: Databases (Tabular and Document), Storage (Files) and Logs (Logs) | A pricing plan |
| **State** | A data-only snapshot of every database adapter in a project, taken at one moment, named, and stored as blobs | A snapshot of Testate's own metadata |
| **Init state** | The state taken when an adapter joins a project. Protected. The target returns to it before a project or adapter deletion | A backup |
| **Stash** | A state Testate takes on its own before a destructive operation (checkout, import, write session). Retention keeps the last N | A state a user names |
| **HEAD** | The state the project's databases last matched: `at_state`, `unknown` after a partial or interrupted checkout, `none` before the first state | A git branch |
| **Checkout** | Restoring a state into the live databases, adapter by adapter, with schema drift checks first | A read of a state |
| **Preflight** | The checkout dry run: drift per adapter, strategy, locking notice, whether a stash will be taken | A test run |
| **Schema drift** | Difference between a state's schema fingerprint and the live schema; blocks a checkout unless forced | Data change |
| **Fingerprint** | A stable hash of the introspected schema: tables, columns, types, nullability, keys | A database version |
| **Diff** | A comparison of two states, or a state and the live database, per table by primary key or row hash | A checkout |
| **Fixture** | Rows extracted from a table plus their referenced parents, as SQL `INSERT`s or JSON, masks applied | A state |
| **Import** | Loading CSV, JSON, or spreadsheet rows into a table through a normalizer, with a preview and a report | A checkout |
| **Normalizer** | The saved answer to how a file is read into one table: which column goes where, how each value is converted, what happens to a row that is already there. Named within its table, so two tables may each have a `weekly`. The word goes all the way down: the route is `/normalizers` and the table is `normalizers` | The schema |
| **Import run** | One execution of a normalizer against one file, with its own report | A normalizer |
| **Column policy** | A per-column rule: required function (`hash_bcrypt`, ...), mask, display flag, lock. Enforced on edits, imports, fixtures, and agent reads | A database constraint |
| **Mask** | A display rule that hides a value (`redact`, `partial`, ...) in every read path, for viewers and agents | Encryption |
| **Write session** | A bounded period in which a `qa` user edits rows in a Tabular adapter; Testate stashes first and can toggle FK checks | An open transaction |
| **Sealed value** | A secret stored as `v1.<kid>.<nonce>.<ciphertext>` under the active key; the API shows `{ set, set_at, key_fingerprint }` | A hashed value |
| **Key ring** | The keys in `TESTATE_SECRETS_ACTIVE_KEY`: the first seals, every listed key opens | A password list |
| **Kid** | The fingerprint of a sealing key, printed in health and in the rotation banner | The key |
| **Sweep** | The boot pass that re-seals every stored value under the active key | A migration |
| **Job** | Long work with a status, progress, cancel, and an SSE stream: snapshot, checkout, diff, import, deletion, backup, migration | A request |
| **Token** | A bearer credential for the REST API with a role, an optional project scope, and an optional expiry | A session |
| **Project scope** | The projects a token or a viewer or tester may see and act on. Every project, or a chosen list, possibly empty. An admin always has every project | A role |
| **Actor** | Who did something: a user, a token, or the system; carried on every audit row and wide event | A role |
| **Role** | `viewer` < `qa` < `admin`, cumulative | A permission list |
| **Agent token** | An API token of kind `agent`: reaches `POST /mcp` only, masks always on. It carries a role like any other token, and the role decides which tools answer | A user |
| **Wide event** | The one structured log line per request or job, with every field the request touched | A log message |
| **Base path** | The sub-path the instance serves under; drives assets, API prefix, cookies | A hostname |
| **Deletion plan** | What a deletion will do per adapter: restore, force over drift, or skip with a reason. The actor confirms it before the job starts | A dry run |
| **Return to init** | The deletion step that checks every database of a project or adapter out to its init state first | Dropping the database |
| **Scaffold** | Code marked `SCAFFOLD:` that answers with typed mock data behind the real contract until its card lands | A stub without a contract |
| **Ponytail** | A comment marking a deliberate shortcut with its ceiling and upgrade path | A TODO |

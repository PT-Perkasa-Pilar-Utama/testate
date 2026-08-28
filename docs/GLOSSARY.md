# Glossary

Terms as the code, the API, and the UI use them. One meaning each. Specs cite this file.

| Term | Meaning | Not |
| --- | --- | --- |
| **Project** | The unit of ownership: a slug, a set of adapters, a set of states, one HEAD, one quota | A Testate deployment |
| **Adapter** | A connection Testate owns to one target: a database, a file store, or an HTTP API | The engine driver code |
| **Engine** | The target technology behind an adapter: `postgres`, `mysql`, `mariadb`, `mongodb`, `s3`, `sftp`, `ftp`, `rest` | A version |
| **Tier** | What an engine supports: **Tabular** (view, state, diff, extract, edit, import), **Document** (view, state, diff, extract), **Files** (view, download) | A pricing plan |
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
| **Import** | Loading CSV, JSON, or spreadsheet rows into a table through a mapping, with a preview and a report | A checkout |
| **Mapping** | How import columns become table columns: transforms, required functions, key columns, mode | The schema |
| **Column policy** | A per-column rule: required function (`hash_bcrypt`, ...), mask, display flag, lock. Enforced on edits, imports, fixtures, and agent reads | A database constraint |
| **Mask** | A display rule that hides a value (`redact`, `partial`, ...) in every read path, for viewers and agents | Encryption |
| **Write session** | A bounded period in which a `qa` user edits rows in a Tabular adapter; Testate stashes first and can toggle FK checks | An open transaction |
| **Sealed value** | A secret stored as `v1.<kid>.<nonce>.<ciphertext>` under the active key; the API shows `{ set, set_at, key_fingerprint }` | A hashed value |
| **Key ring** | The keys in `TESTATE_SECRETS_ACTIVE_KEY`: the first seals, every listed key opens | A password list |
| **Kid** | The fingerprint of a sealing key, printed in health and in the rotation banner | The key |
| **Sweep** | The boot pass that re-seals every stored value under the active key | A migration |
| **Job** | Long work with a status, progress, cancel, and an SSE stream: snapshot, checkout, diff, import, deletion, backup, migration | A request |
| **Hook** | A saved REST request that runs before or after a checkout, ordered, with a fail policy | A webhook Testate receives |
| **Actor** | Who did something: a user, a token, or the system; carried on every audit row and wide event | A role |
| **Role** | `viewer` < `qa` < `admin`, cumulative | A permission list |
| **Agent token** | An API token of kind `agent`: viewer role, reaches `POST /mcp` only, masks always on | A user |
| **Wide event** | The one structured log line per request or job, with every field the request touched | A log message |
| **Base path** | The sub-path the instance serves under; drives assets, API prefix, cookies | A hostname |
| **Return to init** | The deletion step that checks every database of a project or adapter out to its init state first | Dropping the database |
| **Scaffold** | Code marked `SCAFFOLD:` that answers with typed mock data behind the real contract until its card lands | A stub without a contract |
| **Ponytail** | A comment marking a deliberate shortcut with its ceiling and upgrade path | A TODO |

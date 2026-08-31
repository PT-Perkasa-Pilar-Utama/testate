# Product Requirements Document

## Testate

- **Version:** 0.3.0
- **Date:** 2026-08-28
- **Author:** Tech Lead
- **Publisher:** PT. Perkasa Pilar Utama
- **License:** MIT
- **Status:** Draft for review
- **Changes in 0.2.0:** adjudicated 54 findings from two adversarial reviews (product lens, engineering lens). Every finding produced a visible change in this document.
- **Changes in 0.2.1:** project and adapter deletion return every database to its init state before anything is removed. Entered credentials are sealed (write-only). Encryption key rotation follows the Reconflower procedure.
- **Changes in 0.3.0:** adapter tiers (Files, Document, Tabular); phpMyAdmin-style editing with functions, lookups, bulk insert, and a foreign-key-checks toggle; column policies with required functions and masks; tools menu; sample files from the schema; fixture extraction; read-only agent access over MCP. MongoDB import and MongoDB write forms are cut.

---

## 1. Problem Statement

QA teams test on shared databases in dev, SIT, and UAT. Every test run dirties the data. Before the next run, QA asks a developer to reset or re-seed the database. The developer stops feature work, writes or runs a reset script, and confirms by hand. Teams then keep those reset scripts inside the application repository. That code has no business purpose, it targets the production schema, and one wrong flag runs it against production.

Three costs follow:

- Developers lose time on plumbing that is not the product.
- QA waits on a person instead of pressing a button.
- Reset code lives next to production code, so a leak is one merge away.

## 2. Solution

Testate is a self-hosted tool that gives QA "git for the test database". It runs as one Docker image next to the database, on the same intranet. Nobody adds code to the application under test.

A QA engineer opens the dashboard, creates a project, connects one or more databases, and takes a state. A state is a data snapshot of every connected database in the project. Later, QA jumps back to any state with one click or one API call. Testate also lets QA browse tables, run queries, import CSV or XLSX files through saved column mappings, compare two states row by row, browse files on S3, SFTP, and FTP, and call the application's REST endpoints before or after a jump.

Everything in the dashboard is also available as a versioned REST API, so a CI pipeline can reset a database to a named state before every run.

### 2.1 Roles

Roles are cumulative: `admin` includes `qa`, and `qa` includes `viewer`.

| Role | Adds |
| --- | --- |
| `viewer` | Browse projects, adapters, states, tables, files, jobs, diffs, and the audit log. Run read-only queries. Download. |
| `qa` | Create and edit projects, adapters, states, mappings, hooks, REST requests. Checkout, import, write-mode queries, inline edits. Tighten an adapter from `sandbox` to `read-only`. Delete an adapter, which returns its database to init first. |
| `admin` | Users, API tokens, global settings, backups. Loosen an adapter from `read-only` to `sandbox`. Delete a project, which returns every database to init first. |

The first admin comes from environment variables. On first login Testate forces a password change. The admin then creates the other users. A new user receives a temporary password that must change on first login; the admin hands it over outside Testate.

### 2.2 Glossary

| Term | Meaning |
| --- | --- |
| Project | A system under test. Owns adapters, states, mappings, hooks, and a quota. |
| Adapter | A connection owned by a project, with an immutable id. Kinds: database (Postgres, MySQL, MariaDB, MongoDB), storage (S3, SFTP, FTP), REST (an HTTP base URL). |
| Adapter mode | `sandbox` allows checkout, import, and writes. `read-only` refuses all writes. |
| State | A data-only snapshot of one or more database adapters in a project. Never a snapshot of Testate itself. |
| Init state | The protected, single-adapter state Testate takes when a database adapter first connects, or when its connection target changes. |
| Stash | A state Testate takes on its own before a destructive operation. |
| Write session | The period between switching an adapter to write mode in the dashboard and switching it off or leaving the page. The first write in a session takes a stash. |
| HEAD | The state a project last checked out. HEAD is `unknown` after an interrupted or partly failed checkout. |
| Checkout | Restore every adapter in a state to the data in that state. Recorded as a resource with per-adapter results. |
| Diff | A row-by-row comparison of two states, or of a state and the live database. |
| Schema fingerprint | A hash of the schema metadata that matters for restore. Stored with every state, checked before checkout. |
| Drift | The live schema differs from the fingerprint in the state. |
| Mapping | A saved rule set that maps file columns to one table of a Tabular adapter. |
| Import run | One execution of a mapping against one file. |
| Hook | A saved REST request that runs before or after checkout, after snapshot, or after import. |
| Return to init | The restore of a database adapter to its current init state that runs before the adapter or its project is deleted. |
| Deletion plan | The per-adapter list of what a deletion will do: restore, force over drift, or skip with a reason. Confirmed by the actor before the job starts. |
| Job | A long-running operation with progress, a queue position, and a terminal status. Kinds: snapshot, checkout, import, diff, state delete, adapter delete, project delete, archive import, storage migration, backup. Queries are not jobs. |
| Token | A bearer credential for the REST API with a role, a project scope, and an optional expiry. |
| Sealed value | A password, secret, or key that Testate must present to another system. Stored encrypted under the active key, never displayed or returned after entry, replaceable only. |
| Active key list | The comma-separated encryption keys in the environment. The first seals new values; every listed key opens stored ones. |
| Tier | What Testate can do with an adapter. Files (S3, SFTP, FTP): view, download. Document (MongoDB): view, state, diff, extract. Tabular (Postgres, MySQL, MariaDB): view, state, diff, extract, edit, import. |
| Column policy | A rule on one table column of a Tabular adapter: a required function (a value must pass through it before it is stored) and a mask (how viewers and agents see it). |
| Mask | A display rule for a column: `redact`, `partial` (last four characters), or `hash`. Applies to viewers and agents; `qa` and `admin` see raw. |
| Fixture | A row plus its related rows (foreign-key parents, optionally children), extracted as SQL inserts or JSON to reproduce a case elsewhere. |
| Agent token | An API token of kind `agent`: role `viewer`, accepted only by the MCP endpoint, masked results, lower caps, every call audited. |

## 3. User Stories

### Access and accounts

1. As an admin, I want to log in with the bootstrap credentials from the environment, so that a fresh install has exactly one known account.
2. As an admin, I want Testate to force a password change on my first login, so that the bootstrap password never stays in use.
3. As an admin, I want to create users with a role and a temporary password that must change on first login, so that QA and viewers get their own accounts without email delivery.
4. As an admin, I want to disable and delete users, so that leavers lose access the same day.
5. As an admin, I want to reset a user's password to a temporary one that must change on next login, so that a locked-out tester gets back in without me knowing their password.
6. As any user, I want to change my own password, so that I own my credential.
7. As any user, I want Testate to lock my account for fifteen minutes after five failed logins, so that password guessing is slow.
8. As any user, I want my session to end after twelve idle hours and after seven days in any case, so that a forgotten browser tab is not a permanent door.
9. As any user, I want a password change to end every other session of that user, so that a stolen session dies with the old password.

### Projects

10. As a QA engineer, I want to create a project with a name and a slug, so that each system under test has its own space.
11. As a QA engineer, I want to create many projects, so that I can test more than one system from one Testate.
12. As a viewer, I want the project overview to show HEAD, the latest jobs, the adapters, and quota usage, so that I see the state of the system at a glance.
13. As an admin, I want to delete a project by typing its slug, and have Testate return every database adapter to its init state first, so that a retired system's databases are left as Testate found them.
14. As an admin, I want a deletion plan that shows, per adapter, whether Testate will restore, force-restore over drift, or skip (read-only, unreachable, or removed), and lets me choose per adapter, so that deletion never surprises me.
15. As an admin, I want the project to stay in place when any planned restore fails, with HEAD unknown on the failed adapters and a retry, so that a failed cleanup is visible, not silent.
16. As an admin, I want to set a storage quota per project and an instance-wide storage ceiling, so that neither one project nor the sum of projects fills the disk.

### Database adapters

17. As a QA engineer, I want to add a Postgres, MySQL, MariaDB, or MongoDB adapter with a connection string or with host, port, database, user, and password fields, so that Testate reaches the database under test.
18. As a QA engineer, I want to test a draft connection before I save it, and re-test a saved adapter after I change its credentials, so that I find typos immediately.
19. As a QA engineer, I want the connection test to report the engine version, the privileges Testate has, the restore strategy those privileges allow, table count, and approximate size, so that I know what Testate can and cannot do on this database.
20. As a QA engineer, I want Testate to refuse an engine below its minimum version and name the minimum, so that I do not discover version gaps mid-checkout.
21. As a QA engineer, I want to set a new adapter to `sandbox` or `read-only`, and to tighten it to `read-only` later, so that a UAT database that must not be touched is browsable but safe.
22. As an admin, I want to be the only role that can loosen an adapter from `read-only` to `sandbox`, with its own audit event, so that a mis-click or a compromised token cannot unprotect a database.
23. As a QA engineer, I want to add an optional read-only credential to an adapter, so that read-only sessions on MongoDB use a database role that cannot write.
24. As a QA engineer, I want to exclude tables from snapshots and checkouts, so that migration bookkeeping tables and audit tables stay as they are.
25. As a QA engineer, I want Testate to exclude common migration tables by default, so that the application's migration tool keeps its own history.
26. As a QA engineer, I want to pick which Postgres schemas an adapter covers, so that Testate handles multi-schema databases.
27. As a QA engineer, I want Testate to take a protected, single-adapter init state when an adapter first connects, so that every adapter has a baseline.
28. As a QA engineer, I want Testate to take a new init state when I point an adapter at a different host or database, so that the baseline always matches the target.
29. As a QA engineer, I want to rename an adapter without touching its states, mappings, or saved queries, so that names stay readable.
30. As a QA engineer, I want deleting an adapter to return its database to the adapter's init state by default, through the same deletion plan, so that a disconnected database is left as Testate found it.
31. As a QA engineer, I want a deleted adapter's data to stay inside existing states, so that history stays complete while checkouts skip the removed adapter and say so.
32. As an admin, I want Testate to block connections to link-local, cloud metadata, and its own addresses without an off switch, and to manage a deny list of hosts and networks that Testate checks on every connection, so that nobody points Testate at production or at the container host.
33. As an admin, I want Testate to re-check every adapter when the deny list changes and disable the ones that match, so that a rule added today protects adapters created yesterday.
34. As any user, I want every password, secret, or key I enter to be sealed: encrypted at rest, never displayed or returned by the API or the audit log, shown only as "set" with a date and a key fingerprint, and replaceable only, so that a credential entered once cannot be read back out of Testate.

### Browse and query data

35. As a viewer, I want to list tables and collections with row counts, so that I understand the shape of the data.
36. As a viewer, I want to page, sort, and filter rows in a grid, so that I can find a record without writing SQL.
37. As a viewer, I want to run a read-only SQL query with a row limit, a byte limit, and a timeout, so that I can inspect data without risk.
38. As a viewer, I want Testate to enforce read-only mode at the database session level on Postgres, MySQL, and MariaDB, so that a `DELETE` in a read-only query fails at the engine, not at a text filter.
39. As a viewer, I want Testate to tell me when MongoDB read-only mode is enforced by an application filter instead of a database role, so that I know the strength of the guard.
40. As a QA engineer, I want to switch an adapter to write mode in the editor and in the grid, on a `sandbox` adapter only, so that I can fix or set up data by hand.
41. As a QA engineer, I want Testate to stash on the first write of a write session, so that every hand-made change is reversible.
42. As a QA engineer, I want to edit, insert, and delete rows inline in the grid during a write session, so that small data fixes take seconds.
43. As a viewer, I want to run MongoDB find and aggregate operations from JSON forms, so that I can inspect collections without a shell.
44. As a viewer, I want MongoDB adapters to expose find and aggregate only, with no write forms and no import, so that the Document tier stays view, state, diff, and extract.
45. As any user, I want to save queries per adapter with a name, so that the team reuses them.
46. As any user, I want a history of my queries with duration and row count, so that I can rerun yesterday's check.
47. As any user, I want to export a result as CSV or JSON, so that I can attach it to a bug report.
48. As any user, I want to see my running queries and cancel one, and have Testate cancel it inside the database engine, so that a slow query does not keep a lock.

### Import

49. As a QA engineer, I want to upload a CSV or XLSX file and see a preview with detected columns and a sheet selector, so that I know the file parsed correctly.
50. As a QA engineer, I want XLSX date and number cells read from their typed value, so that spreadsheet dates do not need a format string.
51. As a QA engineer, I want to pick a file from a storage adapter as the import source, so that files the application produced can go straight in.
52. As a QA engineer, I want to create a mapping from file columns to the columns of one table of a Tabular adapter, so that the import is explicit.
53. As a QA engineer, I want transforms in a mapping (trim, empty to null, number with locale, date with format, boolean word list, constant, generated id, current time, JSON parse, hash), so that files from business users load without a script and a policed column gets its required function.
54. As a QA engineer, I want to save a mapping per adapter and table and reuse it, so that the weekly import is one click.
55. As a QA engineer, I want to choose append, upsert by key columns, or replace, so that the import matches the test I am setting up.
56. As a QA engineer, I want a dry run that validates types, nullability, key presence, and JSON cells for every row and lists the first hundred errors, and tells me that foreign keys, unique constraints, check constraints, and triggers are only checked by the real run, so that I know what a clean dry run proves.
57. As a QA engineer, I want Testate to stash before a replace import, so that a bad file is reversible.
58. As a QA engineer, I want an import report with inserted, updated, skipped, and failed counts and a downloadable file of rejected rows with the reason per row, so that I know what landed.
59. As a QA engineer, I want to re-import the rejected rows file with the same mapping after I fix it, so that a partial failure does not mean reprocessing the whole file.
60. As a viewer, I want a list of past import runs per project, so that I can answer what was imported when.

### States

61. As a QA engineer, I want to take a state with a name, notes, and tags, so that the snapshot is findable later.
62. As a QA engineer, I want a state to cover every database adapter in the project by default, with the option to pick a subset, so that one state captures the whole system.
63. As a QA engineer, I want each adapter's snapshot to be consistent at one point in time across its tables, so that a state never mixes rows from before and after a write.
64. As a QA engineer, I want state names to be unique inside a project and never look like an id, so that CI can refer to `seeded-baseline` by name without ambiguity.
65. As a QA engineer, I want Testate to record the parent of each state (the HEAD at the time), so that I see the history as a tree.
66. As a viewer, I want a tree view and a list view of states with size, author, time, kind, and tags, so that I find the right one.
67. As a QA engineer, I want to protect a state, so that no single-state delete removes the seeded baseline; only an admin deleting the whole project removes protected states.
68. As a QA engineer, I want to rename a state and edit its notes and tags, except that init states keep their kind and CI filters on kind, so that the history stays readable and scripts stay stable.
69. As a QA engineer, I want to delete an unprotected state as a job that reclaims storage, so that old states do not pile up.
70. As a QA engineer, I want Testate to store snapshots so that an unchanged table costs no extra space between two states, so that frequent snapshots are cheap.
71. As a QA engineer, I want to download a state as one archive and upload it into another project or another Testate, mapping each adapter in the archive onto an adapter of the same engine or creating a new one, so that SIT data moves to UAT without a developer.
72. As a QA engineer, I want snapshots to keep exact types (big integers, decimals, binary, timestamps with zone, JSON, arrays, enums, domains, MongoDB object ids, dates, decimal128, and binary), so that a checkout is byte-faithful.
73. As a QA engineer, I want Testate to name the column types it cannot snapshot, such as Postgres large objects, at introspection time and on every state that contains them, so that a gap is never silent.
74. As a viewer, I want to see the progress of a snapshot per table, so that a long snapshot is not a black box.

### Checkout

75. As a QA engineer, I want to check out a state with one click, so that the database returns to known data.
76. As a QA engineer, I want Testate to stash before every checkout, so that a wrong click is reversible.
77. As a QA engineer, I want Testate to refuse a checkout when the live schema drifted from the state, and show me what differs, so that I do not load data into a changed schema by accident.
78. As a QA engineer, I want a force option that restores the tables and columns present on both sides and reports the rest, so that a one-column deploy does not make my states useless.
79. As a QA engineer, I want a checkout of a partial state to leave the adapters it does not cover untouched and say so, so that the result is never a surprise.
80. As a QA engineer, I want a checkout across several adapters to report each adapter's result, mark HEAD unknown when any adapter fails, and let me re-run only the failed adapters, so that a half-done checkout is visible and repairable.
81. As a QA engineer, I want Testate to reset sequences and auto-increment counters after checkout as a tracked step, and offer a repair action if that step fails, so that the application can insert new rows.
82. As a QA engineer, I want Testate to pick the restore strategy the database user's privileges allow, and tell me which one before I confirm, so that checkout works with the privileges I have.
83. As a QA engineer, I want Postgres data restore to be one transaction, so that other connections see the old data or the new data and never a mix.
84. As a QA engineer, I want Testate to state the atomicity and locking behavior per engine before I confirm, so that I know that MySQL atomic mode locks whole tables for the duration and that MongoDB is best effort.
85. As a QA engineer, I want a checkout that waits on a lock held by the application to fail after a timeout and name the blocking sessions, with the option to terminate them when Testate's privileges allow, so that a forgotten open transaction does not hang the pipeline.
86. As a QA engineer, I want Testate to refuse a second job on the same adapter while one runs, so that two checkouts never interleave.
87. As a viewer, I want a checkout history per project with who, when, from which state, and the per-adapter result, so that I can explain the data I see.

### Diff

88. As a viewer, I want to compare two states and see added, removed, and changed row counts per table, so that I see what a test did.
89. As a viewer, I want to compare a state with the live database, so that I see what changed since the last checkout.
90. As a viewer, I want to drill into one table and see before and after values per changed row, so that I verify the exact effect of a test.
91. As a viewer, I want to export a diff as CSV or JSON, so that it goes into the test report.
92. As a viewer, I want tables without a primary key compared by row content, so that every table gets at least an added and removed count.

### Storage adapters

93. As a QA engineer, I want to add an S3 bucket (including S3-compatible endpoints), an SFTP server, or an FTP server as a read-only adapter, so that I can inspect files the application produced.
94. As a viewer, I want to browse folders, see size and modified time, and filter by name, so that I find the export I am looking for.
95. As a viewer, I want to preview text, JSON, CSV, images, and PDF files up to a size cap, so that I do not download everything.
96. As a viewer, I want to download a file, so that I can inspect it locally.
97. As a QA engineer, I want SFTP to remember the host key from the first connection and refuse to connect when it changes until I accept the new key, so that a swapped host is caught, not logged.

### REST adapters and hooks

98. As a QA engineer, I want to add a REST adapter with a base URL, default headers, and a timeout, so that I can call the application under test from Testate.
99. As a QA engineer, I want to save named requests (method, path, headers, query, body) and run them from the dashboard, so that verification calls are one click.
100. As a viewer, I want to see status, headers, body, and duration of each run, and the last runs of each request, so that I can compare results over time.
101. As a QA engineer, I want to attach saved requests as hooks that run before checkout, after checkout, after snapshot, or after import, in order, so that the application clears caches or reindexes after a data reset.
102. As a QA engineer, I want each hook to say whether a failure aborts or continues the job, so that a flaky notification does not block a checkout.
103. As a QA engineer, I want placeholders for the project, state, and job in a hook request, so that the application knows which state landed.

### Jobs

104. As any user, I want every long operation to return a job with progress and a queue position that I can watch live, so that a queued checkout does not look hung.
105. As any user, I want to cancel a running job, and have Testate cancel the statement inside the engine when the job is waiting on the database, so that a stuck checkout stops.
106. As a viewer, I want a job list per project with status, actor, duration, and error, so that failures are visible.
107. As a QA engineer, I want Testate to mark jobs interrupted by a restart, and flag HEAD unknown when a checkout or its counter-reset step was cut short, so that I never trust a half-restored database.

### Audit

108. As an admin, I want an audit log of every login, user change, token change, adapter change including mode changes, checkout, import, write session, hook run, and deletion with its per-adapter results, with actor, target, and time, so that every destructive action has a name on it.
109. As an admin, I want audit rows to outlive the project and adapter they describe, so that a deleted project's history is still reviewable.
110. As a viewer, I want to filter the audit log by project, actor, action, and date, and export it as CSV, so that an incident review is quick.

### API and automation

111. As an admin, I want to create API tokens with a role, a project scope, and an optional expiry, shown once, so that CI gets least privilege.
112. As an admin, I want to revoke a token and see when it was last used, so that stale tokens die.
113. As a CI pipeline, I want to check out a state by name with one HTTP call and wait for the job in the same call, so that the pipeline script is three lines.
114. As a CI pipeline, I want to take a state after a run, so that a failed run's data is kept for debugging.
115. As a CI pipeline, I want idempotent job creation through an idempotency key, so that a retried request does not run twice.
116. As a developer, I want an OpenAPI document and an interactive reference for the API, so that I can script against it without reading source.
117. As a developer, I want a consistent JSON envelope, stable success and error codes, and cursor pagination with documented limits on every list, so that clients are simple.

### Settings and operations

118. As an admin, I want to choose local disk or S3 as the snapshot store, so that large teams keep snapshots off the container host.
119. As an admin, I want to migrate existing snapshots to a new store as a job, so that a store change loses nothing.
120. As an admin, I want to set how many stashes to keep, how long to keep diffs, query history, job history, and audit rows, the default quota, the API rate limit, and the upload size limit, so that storage is under control.
121. As an admin, I want to run a backup of Testate's metadata and, optionally, every snapshot blob as a job, and restore from it by replacing the volume, so that a lost volume or a failed upgrade is recoverable.
122. As an operator, I want Testate to copy its metadata database before it applies migrations at boot, so that an upgrade can roll back.
123. As an operator, I want to run Testate from one image with one volume and a handful of environment variables, so that setup takes minutes.
124. As an operator, I want Testate to refuse to start without an active key list, so that sealed values are always encrypted.
125. As an operator, I want to rotate the encryption key by listing the new key first and the old key second in the environment and restarting, and see a framed banner with the count of re-sealed values when the sweep completes, so that rotation is one restart and one later cleanup.
126. As an operator, I want Testate to refuse to boot, loudly and before it writes anything, when the configured keys cannot open the stored sealed values, and to name the cause and the fix, so that a bad rotation never destroys credentials.
127. As an operator, I want a declared-loss mode that boots, names every unreadable sealed value, and lets users re-enter them until none remain, so that a truly lost key is recoverable by re-entry.
128. As an operator, I want a backup to record which key fingerprints sealed its values, so that I know which keys a restore needs.
129. As an operator, I want a health endpoint, structured logs, and graceful shutdown, so that Testate behaves behind nginx and inside compose.
130. As an operator, I want Testate to serve under a sub-path from the same prebuilt image, and to warn me when that sub-path shares a hostname with the application under test, so that it fits an existing nginx without a silent security downgrade.

### Tools

131. As any user, I want a hash generator (argon2id, bcrypt, sha256, sha512, hmac with a secret, optional salt), so that I can produce a stored hash without leaving the dashboard.
132. As any user, I want a random secret generator (bytes to hex, base64, base64url), so that test credentials are strong and unique.
133. As any user, I want a UUID generator for v4 and v7 with a count, so that I can fill ids in fixtures and forms.

### Agent access

134. As an admin, I want to create an agent-kind token with project scope and an expiry, so that an AI agent gets least-privilege read access.
135. As a developer, I want to connect an AI agent to Testate over MCP with that token and list tables, describe a table, page rows, and run read-only queries, so that the agent inspects SIT or UAT data without a database credential.
136. As a developer, I want the agent to extract a fixture (a row plus its related rows) as SQL or JSON, so that I can reproduce a bug on a local database.
137. As an admin, I want every agent tool call audited with the tool name and target, so that agent access is reviewable.
138. As an admin, I want masked columns to stay masked for agents with no way to unmask, so that an agent never copies a secret into a prompt or a file.
139. As an admin, I want agent tokens refused on every non-MCP route and standard tokens refused on MCP, so that the two access paths cannot be confused.

### Editing, policies, and fixtures (Tabular tier)

140. As a viewer, I want the table view to show foreign keys in and out and link an FK cell to the referenced row, so that I can follow relations the way phpMyAdmin's relation view does.
141. As a QA engineer, I want an insert form with a typed input per column, NULL and default checkboxes, and a function dropdown (now, uuid, random bytes, hash), so that a row is right the first time.
142. As a QA engineer, I want FK columns in forms and in the grid to offer a lookup that searches the referenced table, so that I never type a wrong key.
143. As a QA engineer, I want to insert up to fifty rows in one form and "insert and add another", so that seeding a handful of rows is quick.
144. As a QA engineer, I want an edit form for an existing row with the same inputs, where a hashed column shows only that it is set and accepts a new value through its function, so that a hash is never displayed or replaced by plain text.
145. As a QA engineer, I want a foreign-key-checks toggle for a write session and for an import run, with the engine mapping shown before I switch it, so that I can load related rows out of order like phpMyAdmin.
146. As a QA engineer, I want column policies per table column, a required function (for example hash as bcrypt) and a mask, so that a password column can never be stored raw through forms, grid, or import.
147. As an admin, I want to lock a policy so that qa cannot remove it, so that a compliance rule survives.
148. As a viewer, I want masked columns shown as redacted, partial, or hashed values while qa sees raw, so that viewers and agents never see secrets.
149. As a QA engineer, I want a sample CSV or XLSX generated from a table's schema or from a saved mapping, with an example row and a schema block, so that the first import file is right.
150. As a viewer, I want to extract a fixture for a row (its FK parents to depth three, optionally children, masked by role) as SQL inserts or JSON, so that I can reproduce a case on a local database.

## 4. Implementation Decisions

### 4.1 Architecture

- One process, one container, one volume. A Hono API serves the REST API and the built single-page app. Metadata lives in a SQLite file on the volume through Bun's SQL API, opened in WAL mode with a busy timeout. Snapshots live on the volume or in S3 through Bun's S3 client.
- Backend modules are vertical slices: one folder per feature holding its router, handler, service, repository, schema, and test. Engine drivers and storage drivers are shared infrastructure behind two ports, because several modules use them.
- The frontend is SolidJS 2.0 with Vite, Tailwind 4, and Cloudflare Kumo design tokens. Components are hand-rolled Solid components in the Kumo look, ported from the Audionesia project. No component library. Each feature follows model, presenter, view: the model calls the API, the presenter owns signals and actions, the view is JSX only.
- Routing is a small in-house router over the history API with a route table, because the Solid 2 line of the official router is a prerelease. Swap it when a stable release lands. This is the one deliberate shortcut in the plan.
- Sub-path serving: the frontend is built once with a placeholder base path. At boot Testate rewrites the built assets with the configured base path into its working directory, and derives the API prefix and the cookie path from the same setting.
- Validation uses valibot at every trust boundary: HTTP input, files, adapter responses, stored settings. OpenAPI is generated from the same schemas through the standard-schema bridge and served with an interactive reference.
- UI copy is English. Identifiers, logs, and API fields are English.

### 4.2 Engine port

One `DbEngine` port with three drivers: Postgres, MySQL (also serves MariaDB, with per-engine branches where the dialects differ), MongoDB. Minimum versions, enforced by the probe: Postgres 13, MySQL 8.0, MariaDB 10.6, MongoDB 6.0. The port covers:

- probe: version, privileges, capability flags (can disable triggers, can set the replication role, can truncate, can terminate sessions, supports transactional restore, supports deferrable constraints), table count, size estimate, and the restore strategy those flags select
- introspect: tables, columns with types, nullability, defaults, generated and identity flags, primary keys, foreign keys, unique and check constraints, sequences, views (listed, never restored), partition children (folded into their parent), inheritance children (separate units), unsupported column types (named)
- fingerprint: hash of the introspection subset that affects restore
- read a table as chunks of JSON lines sorted by primary key, inside a consistent read transaction
- restore a set of tables with the strategy the probe selected
- run a query in read or write mode with row, byte, and time limits, list running queries, and cancel one inside the engine
- write rows for import and inline edit

Consistency: a snapshot of one adapter is one point in time across all its tables. Postgres uses a repeatable-read transaction with a server-side cursor per table. MySQL and MariaDB use a consistent-snapshot transaction with keyset chunks; tables on non-transactional storage engines are read outside it and flagged. MongoDB uses snapshot read concern on replica sets and is best effort on a standalone server. Across adapters in one project, snapshots start together but are not one instant.

Type fidelity:

- Postgres serializes each row to JSON on the server, with the session time zone pinned to UTC, and streams the text without parsing it. Restore inserts through an explicit column list derived from introspection, casting JSON back to the column types on the server, skipping generated columns and overriding system values on identity columns. Verified to round-trip binary, numerics including special values, timestamps with zone, arrays of composites, enums, domains, and text search vectors. Large objects are not captured; introspection names them and every state containing them carries the warning.
- MySQL and MariaDB build a JSON object per row on the server with big integers and decimals cast to strings. Restore inserts in batches sized under the server's packet limit.
- MongoDB uses canonical Extended JSON, so object ids, dates, decimal128, and binary round-trip. Testate measures the encoded size of each document against the sixteen-megabyte document limit before it accepts it into a snapshot. Views are excluded from restore. Time-series collections are detected; their updates are limited to the metadata field, and arbitrary deletes require MongoDB 7.0, probe-gated.
- Grid and query reads on Postgres go through the same server-side JSON path, so column types the driver does not decode (geometry, point, multi-dimensional arrays) still display.

Restore strategy, selected per adapter from the probe:

| Engine | Emptying | Foreign keys | Atomic | Locking |
| --- | --- | --- | --- | --- |
| Postgres | One `TRUNCATE` listing the database-wide foreign-key closure of the restored tables; `DELETE` for any table referenced by an out-of-scope table | Default: insert in dependency order, with deferrable constraints checked at commit. Trigger disable only when the probe proves the privilege (superuser, or a Postgres 15 grant on the replication-role parameter) | Yes for data; counter reset is a tracked post-commit step | Exclusive table locks; lock wait bounded by a timeout |
| MySQL / MariaDB | `DELETE` inside a transaction (atomic mode, default); `TRUNCATE` (fast mode) only when the probe proves the drop privilege | Session-level foreign key checks off | Atomic mode only; counter reset is a tracked post-commit step | Atomic mode locks each whole table against writers for the duration |
| MongoDB | `deleteMany` per collection, indexes kept, original ids kept | Not applicable | No | Per-operation |

Dependency order handles self-referencing tables by inserting parents first, and by two-phase insert and update when the referencing column is nullable. A cycle on non-nullable, non-deferrable columns without trigger-disable privilege fails before any data is touched, with a message naming the privilege to grant. If an excluded table holds rows that reference a restored table, the checkout fails before any data is touched and names that table.

Lock handling: the restore connection sets a lock timeout (adapter setting, default sixty seconds). On timeout the checkout fails with a `CHECKOUT_BLOCKED` error listing the blocking sessions when the engine exposes them. Terminating blocking sessions is an explicit option, shown only when the probe proves the privilege.

Counter reset: after the data transaction commits, Testate resets Postgres sequences and MySQL auto-increment counters as a tracked sub-step, because Postgres sequence updates do not roll back and MySQL counter resets commit implicitly. A failure in that step leaves the job `partial` with a repair action, and HEAD stays unknown until the repair succeeds.

Query limits: read-only mode opens a read-only transaction on Postgres, MySQL, and MariaDB. On MongoDB, read-only mode uses the adapter's read-only credential when present and an application-level operation filter otherwise, and the dashboard shows which one is active. Row caps wrap the user's statement as a sub-query; a byte budget and a time budget apply on top. Time budgets use the engine's own mechanism, which differs between MySQL and MariaDB. Cancel uses the engine's cancel mechanism from a second connection.

Default excluded tables: the history tables of Drizzle, Prisma, Knex, TypeORM, MikroORM, Sequelize, Flyway, Liquibase, Alembic, Django, Rails, and Entity Framework. Editable per adapter.

### 4.3 Fingerprint

Included: schema-qualified table names; columns by name with data type, nullability, default presence, generated and identity flags; primary keys; foreign keys; unique constraints; check constraint expressions; MongoDB collection options and validators. Columns are sorted by name before hashing.

Excluded: physical column order, index names and definitions, comments, storage parameters, sequence values, statistics, view definitions, MongoDB index definitions.

An online schema rebuild that changes nothing in the included set produces the same fingerprint. A new non-null column changes it.

### 4.4 Snapshot store

- Content-addressed blob store. Each table stream is gzip-compressed, hashed, and stored once under its hash. A state manifest lists adapters by immutable id, tables, row counts, byte sizes, fingerprint, unsupported-type warnings, and blob hashes. Two states that share an unchanged table share one blob. Reference counts live in metadata. Blobs referenced by a running snapshot are pinned; garbage collection runs as part of the state-delete job and removes only blobs with no manifest and no pin.
- Blob bytes are deterministic for unchanged data: the session time zone is pinned, rows are sorted by primary key, and tables without a primary key are sorted by row hash.
- Local driver writes under the data directory. S3 driver writes the same layout under a prefix. A migration job copies every referenced blob to the new store and then switches the setting. Store switches are refused while jobs run.
- A state archive is a PAX-format tar of the manifest and its blobs, written as a stream, so a multi-gigabyte download starts immediately and needs no scratch space. Upload verifies hashes before creating the state and asks for an adapter mapping per engine, with a create-new-adapter option.
- Streams sorted by primary key make diff a merge of two sorted streams. Tables without a primary key are compared by row hash.
- Quota counts unique blob bytes referenced by a project. Testate warns at eighty percent and refuses new states at one hundred percent. An instance-wide ceiling applies the same thresholds to the whole store.

### 4.5 States, HEAD, stash

- Ids are UUID version 7. State names are unique per project, case-insensitive, and may not match the UUID pattern.
- A state belongs to a project and covers a chosen set of database adapters by immutable id, all by default. Init states are the one exception: each covers a single adapter.
- The parent of a new state is the project HEAD at snapshot time. HEAD moves on checkout and on snapshot.
- Kinds: `init` (protected forever), `manual`, `stash`. Protection is a flag users can set on manual states. Protection guards against single-state deletion; an admin deleting the project removes every state, protected or not, after typing the slug.
- Adding a database adapter, or changing its host, port, or database, takes an init state for that adapter. The first adapter of a project produces the state named `init`; later ones produce `init-<adapter>`. Renaming an adapter changes nothing else.
- Deleting an adapter keeps its data in every state that references it. Manifests show the adapter as removed. Checkout skips removed adapters and reports them.
- Deletion returns databases to init first. Project deletion (admin) and adapter deletion (qa) are jobs that start with a deletion plan. The plan lists each database adapter with one action: restore to the adapter's current init state (the most recent init state for that adapter id), force over drift, or skip with a reason (read-only, unreachable, removed). Restore is the default; the actor may change an adapter to force or skip and confirms the plan, typing the slug for a project. The job runs the planned restores exactly like checkouts, hooks included, without a stash, and only after every planned restore succeeded does it remove the project or adapter, its states and blobs by reference count, mappings, hooks, and project-scoped tokens. A failed restore leaves everything in place, sets HEAD unknown for the failed adapters, and offers a retry of the failed adapters only. Audit rows outlive the deleted project and adapter.
- Stash runs before checkout, before replace import, and on the first write of a write session. Stash retention keeps the last N per project; protecting a stash converts it to a manual state.
- Checkout of a state that drifted returns a `SCHEMA_DRIFT` error with the differing tables and columns. `force` restores the intersection and reports what was skipped and which live columns received defaults.
- A checkout job restores adapters in parallel under the concurrency cap and records a result per adapter: restored, skipped, rolled back, or unknown. Any failure sets project HEAD to unknown. The checkout resource offers a retry limited to the failed adapters.
- One job per adapter at a time. Global concurrency defaults to two. Jobs beyond the cap queue and expose their position.

### 4.6 Query and grid

- Write mode requires the `qa` role and a `sandbox` adapter and is a per-adapter switch in the dashboard. Switching it on starts a write session; the first write in the session takes a stash; switching it off or leaving the page ends the session. Inline grid edits, write-mode SQL, and MongoDB write forms are all writes in the session.
- Row limit defaults to five hundred, maximum five thousand. Result byte budget and timeout come from settings; the timeout defaults to thirty seconds, maximum five minutes.
- Grid paging uses keyset pagination when the table has a primary key and offset paging otherwise. Inline edit requires a primary key and saves one row per action.
- MongoDB queries come from JSON forms for find and aggregate. No write forms, no JavaScript evaluation.
- Tabular editing follows phpMyAdmin: relation view, FK lookups, typed insert and edit forms with a function dropdown (now, uuid v4 and v7, random bytes, hash as bcrypt, argon2id, sha256, sha512, hmac), bulk insert of up to fifty rows, and a foreign-key-checks toggle per write session mapped to `SET FOREIGN_KEY_CHECKS = 0` on MySQL and MariaDB and, on Postgres, to constraints checked at commit or to the replication role when the privilege allows.
- Column policies per adapter, table, and column: a required function and a mask. Forms, grid edits, and import mappings refuse a policed column without its function. Masks (`redact`, `partial`, `hash`) apply to viewers and agents in the grid, query results, diffs, exports, and fixtures; `qa` and `admin` see raw. An admin can lock a policy. Raw SQL in a write session is not policed; the stash is the safety net and the session start says so.
- Fixture extraction: a row plus its foreign-key parents to depth three, optionally children up to five hundred rows, as SQL inserts in dependency order in the engine's dialect or as JSON, masked by role. MongoDB extracts the single document.
- Running queries are listed per adapter with a cancel action. Queries are synchronous requests, not jobs.
- Saved queries are per adapter. History is per user with a retention setting.

### 4.7 Import

- Sources: upload (size limit from settings) or a file on a storage adapter.
- Parser: streaming CSV with delimiter detection and UTF-8 with BOM; XLSX with sheet and header row selection, reading typed date and number cells from their typed value.
- Tabular adapters only. Mapping: target table, column pairs, transforms, key columns, mode. Transforms: trim, empty to null, number with locale, date with format, boolean word list, constant, generated id, current time, JSON parse, hash. A policed column requires its function in the mapping.
- Sample file: for any table or saved mapping, a CSV or XLSX with the header row, one typed example row, and a schema block (type, nullable, default, foreign key target, required), so the first file matches the schema.
- Dry run validates every row for target column types, nullability, key presence, and JSON cells, and returns counts plus the first hundred errors. It states that foreign keys, unique constraints, check constraints, and triggers are checked by the real run only. A run writes in batches inside a transaction where the engine allows. Replace mode stashes first.
- Report: inserted, updated, skipped, failed, duration, and a CSV of rejected rows with the reason per row, re-importable with the same mapping. Upload files are deleted when the job ends. Import runs are listed per project.

### 4.8 Storage adapters

- S3 driver uses Bun's S3 client with bucket, prefix, region, optional endpoint, and the virtual-hosted-style flag off for path-style endpoints. SFTP uses password or private key with trust-on-first-use host keys; a changed host key blocks the connection until an admin or QA accepts the new key. FTP supports plain and explicit TLS.
- Operations: list a directory (paged), stat, read as a stream. No write, no delete.
- Preview cap and download stream through Testate, so the browser never sees storage credentials.
- Storage and REST connections pass the same address check as database adapters on every connection.

### 4.9 REST adapters and hooks

- Requests run from the server, so intranet targets work and CORS does not apply. Redirects are never followed; a redirect response is shown as is. Response body cap and timeout come from the adapter. Secrets in headers are encrypted at rest and masked in the UI.
- Saved requests keep the last fifty runs. Placeholders `{{project.slug}}`, `{{state.name}}`, `{{state.id}}`, and `{{job.id}}` expand in path, query, headers, and body.
- Hooks bind a saved request to a trigger with an order and a fail policy. Hook results attach to the job. Testate never snapshots or restores through REST; that would require the dev-only endpoints Testate exists to remove.

### 4.10 Jobs

- Persisted queue in metadata. One dispatcher runs jobs as concurrent tasks up to the global cap; each task's failure is isolated from the others. Progress per table with row counts. Live updates over server-sent events. Cancel sets a cooperative flag checked between batches and, for a job waiting on the database, cancels the statement inside the engine.
- Job creation returns `202 Accepted` with the job and a `Location` header. A `wait` parameter up to five minutes blocks until the job ends; the nginx example sets a read timeout above that. An `Idempotency-Key` header returns the existing job on retry for twenty-four hours per token.
- On boot, running jobs become `interrupted`. If the interrupted job was a checkout, an import, a counter-reset step, or the restore phase of a project or adapter deletion, the project HEAD becomes `unknown` and the dashboard shows a banner until the next successful checkout. An interrupted deletion removes nothing.

### 4.11 REST API

- Base path `/api/v1`. Bearer tokens for automation, HTTP-only cookie sessions for the dashboard, CSRF protection through same-site cookies plus a custom header check. Testate must run on its own hostname when the application under test is not fully trusted; a shared hostname makes both the same origin, and the deployment guide and the boot log say so.
- Success codes: `200` for get, list, update, and actions that finish inline; `201` for create; `202` for every job-backed operation, including job-backed deletes of projects, adapters, and states; `204` for inline deletes.
- Envelope: `{ "data": ... }` on success, `{ "error": { "code", "message", "details" } }` on failure. Lists return `{ "data": [], "page": { "next_cursor", "limit" } }`. Default page size fifty, maximum two hundred. Each list documents its filter and sort fields in the API specification.
- Projects are addressed by slug, everything else by UUID version 7. A checkout body names `state_id` or `state_name`, never both. A state lookup by name is a list filter.
- Token scope limits every list and every action to the scoped projects. A project-scoped token listing projects sees only its scope.
- Rate limits: five failed logins lock the account for fifteen minutes; API tokens get a per-minute request budget from settings. Both answer `429`.
- Checkouts are resources. Creating one performs the restore and records who, when, from which state, and the per-adapter result.

Resources:

| Resource | Operations |
| --- | --- |
| `auth` | login, logout, me, change password |
| `users` | list, create, get, update, disable, delete, reset password |
| `tokens` | list, create (shown once), revoke |
| `projects` | list, create, get, update, head, deletion plan, delete (job) |
| `projects/{slug}/adapters` | list, create, get, update, deletion plan, delete (job), test draft connection, re-test, schema, table rows, query, running queries, cancel query, saved queries, query history, import mappings |
| `projects/{slug}/imports` | list, create (dry run or run), get report, download rejected rows |
| `projects/{slug}/states` | list, create, get, update, delete (job), archive download, archive import (job) |
| `projects/{slug}/checkouts` | list, create, get, retry failed adapters |
| `projects/{slug}/diffs` | list, create, get summary, get table rows, delete, export |
| `projects/{slug}/storage/{id}` | list entries, stat, preview, download, accept host key |
| `projects/{slug}/rest/{id}/requests` | list, create, update, delete, run, runs |
| `projects/{slug}/hooks` | list, create, update, reorder, delete |
| `jobs` | list, get, cancel, events |
| `audit-logs` | list, export |
| `settings` | get, update, migrate storage, backup |
| `health` | liveness; details for admins |

Error codes: `VALIDATION_ERROR` 400, `UNAUTHORIZED` 401, `FORBIDDEN` 403, `ADAPTER_READ_ONLY` 403, `NOT_FOUND` 404, `CONFLICT` 409, `SCHEMA_DRIFT` 409, `JOB_IN_PROGRESS` 409, `CHECKOUT_BLOCKED` 409, `QUOTA_EXCEEDED` 409, `PAYLOAD_TOO_LARGE` 413, `ENGINE_UNSUPPORTED` 422, `HOST_BLOCKED` 422, `RATE_LIMITED` 429, `ADAPTER_UNREACHABLE` 502, `INTERNAL` 500.

### 4.12 Security

- Sealed values: database passwords and connection strings, S3 keys, SFTP passwords and private keys, FTP passwords, REST adapter and hook header secrets, and the snapshot-store credentials in settings. Each is encrypted with AES-256-GCM under the first key of the active key list, with a fresh random ninety-six-bit nonce per record, and stored with the fingerprint of the key that sealed it. Sealed values never leave the server: API responses, exports, state archives, and audit rows omit them; the dashboard shows "set", the date, and the key fingerprint. Update forms accept a new value or keep the old one. Passwords and API tokens are hashed, not sealed.
- Active key list, after the Reconflower procedure: the environment holds one to five base64 thirty-two-byte keys, comma separated, new key first. Testate refuses to start without it. At boot, before jobs start, Testate opens every sealed value with the list and re-seals under the first key anything sealed by another key. The boot log prints a framed banner: `SECRET KEY ROTATION COMPLETE` with the count, `SECRET KEY ROTATION NOT YET COMPLETE` when a value changed mid-sweep, or `EXTRA VALUE STILL CONFIGURED` while a retired key remains listed. The info log carries the active key fingerprint, which changes on a real rotation.
- Refusals are loud, name the cause and the fix, and happen before anything is written: no stored value opens with the configured keys; N of M values open with no configured key; an empty, malformed, or wrong-length value; the same key twice; more than five values. Rolling back is a rotation in reverse, with the key to revert to listed first. Declared loss: a flag in the environment lets Testate boot, name each unreadable value in the error log, and accept re-entry; remove the flag when a boot reports zero unreadable values.
- Backups store sealed values as they are and record the key fingerprints they need. A restored backup boots only with those keys listed.
- Passwords are hashed with Bun's password API (argon2id). Minimum length twelve. API tokens are random, prefixed for display, and stored as SHA-256 hashes compared in constant time; token checks stay fast on the CI path.
- Sessions are opaque server-side tokens in HTTP-only, same-site cookies. Idle timeout twelve hours, absolute seven days. A password change revokes every session of the user.
- Tokens carry a role, a project scope, and an optional expiry.
- Address check on every outbound connection (database, storage, REST): Testate resolves the host and refuses link-local ranges, cloud metadata addresses, and its own listening address without an off switch. Admins manage a deny list of hostname patterns and networks; loopback is on it by default and removable. Changing the list re-checks every adapter and disables matches. Deny-list checks run at connection time, not only at save time.
- Changes to Testate's own entities (users, tokens, adapters, settings) write their audit row in the same metadata transaction. Actions on a target database (checkout, import, write session, deletion restore) get an audit row when accepted, updated with the outcome, because no transaction spans Testate's metadata store and the target engine. Audit rows carry the project slug and adapter name as text, so they survive deletion of what they describe.
- Testate runs as a non-root user in the container.

### 4.13 Deployment

- Image `ghcr.io/pt-perkasa-pilar-utama/testate`, tags `latest` and semver, built on the manual **Deploy image** workflow, for the runner's own architecture. Multi-architecture builds are not set up yet. Base image is the slim Bun 1.4 image. No database client binaries.
- Volume `/data` holds the metadata database, local snapshots, temporary uploads, and pre-migration copies of the metadata database.
- Environment: port, active key list, declared-loss flag, data directory, base path, bootstrap admin user and password, trust proxy flag, upload limit, log level, optional snapshot store settings.
- A docker compose example and an nginx example ship with the repository. The nginx example sets the upload size and a read timeout above the five-minute wait ceiling for server-sent events and long polls.
- Health endpoint answers liveness without authentication and checks for admins: metadata database, data directory writable, snapshot store reachable, dispatcher heartbeat.
- Boot: validate the active key list, copy the metadata database, apply numbered migrations, sweep and re-seal sealed values, rewrite the frontend base path, recover interrupted jobs, then listen. Graceful shutdown on `SIGTERM`: stop taking jobs, finish or roll back the current batch, exit within thirty seconds.
- Backup job: a PAX tar of the metadata database and, optionally, every referenced blob, written to a download or to the snapshot store. Restore is documented as replacing the volume contents.

### 4.14 Data model

Metadata entities: user, session, token, project, adapter, adapter capability, state, state adapter manifest, blob, checkout, checkout adapter result, job, hook, hook run, import mapping, import run, saved query, query history, rest request, rest request run, diff, diff table, audit log, setting, idempotency key.

Every mutable entity carries an id, created and updated timestamps. Every sealed value carries its nonce and the fingerprint of the key that sealed it. Migrations for the metadata database are numbered SQL files applied at boot by a runner that resolves them relative to the application, never by absolute path.

### 4.15 Tiers

| Tier | Engines | View | Download | State, checkout, diff | Extract fixture | Edit | Import |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Files | S3, SFTP, FTP | list, preview | yes | | | | |
| Document | MongoDB | find, aggregate | | yes | document by id | | |
| Tabular | Postgres, MySQL, MariaDB | grid, SQL | | yes | FK walk | forms, grid, write session | yes |

The probe reports the tier; every module refuses an operation outside the tier with `ENGINE_UNSUPPORTED`.

### 4.16 Tools

Stateless endpoints and a Tools menu: hash (argon2id, bcrypt, sha256, sha512, hmac with a secret, optional salt, cost capped), random secret (bytes to hex, base64, base64url), UUID v4 and v7 with a count. Any role. Nothing stored, nothing logged with inputs, rate-limited per actor. The same hashing code serves the form functions and the import transform.

### 4.17 Agent access

Testate serves a Model Context Protocol server over Streamable HTTP at `/api/v1/mcp`, authenticated with an agent-kind token (role `viewer`, project scope, expiry required). The server registers read tools only: list projects, adapters, tables; describe a table; page rows; get a row with its parents; run a read-only query; extract a fixture; list and get states; diff summary; list and preview files. Masks always apply; caps are lower than the dashboard (200 rows default, 1 000 max, 15 s, 256 KiB previews); every call is audited as `agent.tool_call`. Agent tokens are refused on every other route and standard tokens on MCP. Setup for Claude Code and generic clients lives in `AGENT_ACCESS.md`.

### 4.18 Non-functional targets

- Designed for databases up to five gigabytes and five hundred tables per adapter. Larger databases work but slower; the ceiling is documented, not enforced.
- Postgres restore runs on batched inserts, because the runtime's SQL driver has no bulk-copy path. Snapshot and restore throughput are measured in Sprint 0 on each engine and recorded in the technical specification; the levers are batch size and connection parallelism.
- Dashboard list and detail pages respond within three hundred milliseconds at the ninety-fifth percentile with the metadata database on local disk, measured under concurrent job writes.
- Desktop-first layout, usable down to tablet width. Current Chrome, Firefox, and Safari.
- Concurrency: one job per adapter, two jobs per instance by default.

## 5. Testing Decisions

A good test checks external behavior: given inputs and a state, assert outputs and side effects. It never asserts on private helpers or call order.

- Unit tests with the Bun test runner for pure modules: snapshot codec, fingerprint inclusion and exclusion, foreign-key closure and dependency ordering with cycles, diff merge, mapping transforms and coercion, crypto, job and checkout state machines, address check, router matching, presenter logic.
- Integration tests against real engines in CI through docker compose: Postgres, MySQL, MariaDB, MongoDB. Each engine driver runs the same contract suite: probe and strategy selection, introspect including partitions and unsupported types, consistent snapshot under concurrent writes, restore with an out-of-scope referencing table, drift detection, force restore, counter reset and repair, lock timeout, type round-trip, query limits and cancel, read-only enforcement. The storage drivers run against MinIO, an SFTP container, and an FTP container. These are the core of Testate and are never mocked.
- API tests boot the Hono app in-process against a temporary metadata database and exercise every endpoint through HTTP: auth, cumulative roles, token scope, envelope shape, success codes, pagination limits, job flow with `wait` and queue position, idempotency, error codes.
- Browser smoke tests with Playwright drive the built app through login, add adapter, snapshot, checkout, diff, import, and a write session with stash, in the style of the Audionesia smoke script.
- Prior art: Audionesia for pure-module tests and the smoke script; Tatanan for Hono module tests with Arrange-Act-Assert.

## 6. Out of Scope

- Firebase and Firestore. No snapshot API outside managed export.
- SQLite as a target database.
- Snapshot or restore through the application's REST API.
- Schema migrations. The application under test owns its schema; Testate detects drift and stops.
- Postgres large-object content. Named as unsupported at introspection time.
- MongoDB import and MongoDB write forms. The Document tier is view, state, diff, extract.
- Writes of any kind through agent access.
- Branches, merges, and cherry-picks between states. There is no merge for data.
- Single sign-on, LDAP, and email delivery.
- Multi-tenant hosting. One Testate serves one organization.
- Metrics endpoint and tracing.
- Internationalized UI.

## 7. Further Notes

- Work model: single developer with coding agents. Feature branches into a protected `main`, CI on every push, image build on release.
- Sprint 0 spikes, each with a fixed outcome:

| Spike | Pass | Fail path |
| --- | --- | --- |
| MariaDB over Bun's MySQL driver | Connects on MariaDB's default authentication plugin; timeout and packet-size code paths branch per engine | `mysql2` driver for both MySQL and MariaDB |
| ssh2 under Bun 1.4 with the Simulflow patch | Full SFTP session (connect, list, stat, stream) with no crash; patch applies to the resolved version | Pure-JavaScript SSH implementation |
| OpenAPI from valibot through the standard-schema bridge | Correct spec for a route using a pipe or transform schema, not only a plain object | Hand-written operation descriptors next to each schema |
| FTP library under Bun | Connect, list, and stream download against an FTPS server with no hang | Alternative pure-JavaScript FTP client |
| MongoDB driver under Bun 1.4 | Connect, find, insertMany, deleteMany, killOp with only non-optional dependencies | Pin the driver version that passes |
| Postgres restore throughput without bulk copy | Restore time for a representative five-gigabyte schema recorded against the target | Larger batches and more connection parallelism |
| Statement cancel reaches the server | Backend stops within a bounded time, observed from a second connection, on all four engines | Cancel from a second connection with the engine's own command |
| Dashboard latency under job writes | Three hundred milliseconds at the ninety-fifth percentile with the dispatcher writing progress | Move job progress writes to batched updates |
| MongoDB Extended JSON round-trip sampler | Edge types (double special values, symbol, code with scope, min and max keys) survive snapshot and restore | Name the failing types as unsupported, like large objects |
| MCP transport for Hono (`@hono/mcp` with `@modelcontextprotocol/sdk`) | `initialize`, `tools/list`, `tools/call`, `resources/read` work from Claude Code against the endpoint behind nginx | In-house JSON-RPC handler for that subset |

- Reused from sibling projects: the SolidJS 2.0 skill, the Kumo design skill, the vendored anti-slop lint rules, the lefthook configuration, the Simulflow ssh2 patch, and the Reconflower key rotation procedure, which Testate documents in its own `KEY_ROTATION.md`.
- Naming: the tool is Testate. A state is a snapshot; the UI says "state" everywhere. HEAD, checkout, stash, and diff keep their git meaning.
- Tagline: "Git for your test database." Hero line under it: "Reset the database, not the developer."

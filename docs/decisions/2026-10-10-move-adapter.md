# Moving an adapter to another project: decisions

Date: 2026-10-10. Issue: #77.

The user delegated these decisions to the advisor; they are recorded as decided at the user's request. Prefix M, so they do not collide with Q, S or I of the logs-tier log.

| # | Question | Decision | Why |
|---|----------|----------|-----|
| M1 | Which kinds move? | All three: database, storage, logs. Storage and logs change project and nothing else. A database moves under M2 and M3. An `ingest` adapter into Inspect stays refused (Q10 of 2026-10-10-logs-tier.md). | The motivating case is a database: every new one gets an init snapshot at once, so "the wrong project" is noticed after the fact. Storage and logs hold no history. |
| M2 | A database the source project's states already hold? | Allowed. Its manifests in the source project's states are marked `removed`, exactly as deleting an adapter does, and nothing is restored first: the database keeps what it holds now. The dialog says so before the confirm: "Project A's states can no longer restore this database. It keeps what it holds now." ADR 0005. | Refusing would block the common case, because the init snapshot holds every database from the start. Restoring first would rewrite a database its owner meant to keep. |
| M3 | An init snapshot in the new project? | Into a regular project: the create path. The target must be at its starting point (#63) and the name free, then an init job. Into Inspect: none, since Inspect takes no init. | One rule for a database joining a project, whether it is created there or moved there. |
| M4 | The mode after a move? | A move never loosens it. Into Inspect: `read_only` (Q5 of #56). Out of Inspect: stays `read_only`; an admin loosens it afterwards, audited, as today. Between regular projects: unchanged. | Loosening is its own audited act; a move that opened writes would hide it. |
| M5 | Who may move? | Two checks, both required. Manage rights where it is: tester and up, and in Inspect the owner rule. Create rights where it goes: tester and up, with the target in the caller's scope. An admin passes the owner rule, as everywhere. | Deleting an adapter is a tester's act, and a move is less destructive. |
| M6 | Running jobs and open write sessions? | Refused with `JOB_IN_PROGRESS` while the source project has an unfinished job, and with `CONFLICT` while the adapter has an open write session. The target needs no extra check: a running checkout there moves HEAD, and M3's starting-point rule refuses. | A move during a restore or a session would leave either one pointing at the wrong project. |
| M7 | Where in the UI? | The adapter page only: "Move to project…" beside Edit, a dialog with a project picker. For a database the picker greys out projects not at their starting point, Inspect first (the Databases dialog's picker); for storage and logs every project is offered. After the move the page opens under the new project. One audit row, `adapter.moved`, under the destination, with `{ from: { id, slug }, manifests_marked, init_job }`. | The adapter page is where its owner manages it; the tier menus list, they do not manage. |

## Build note

Today a checkout finds a state's adapter by id alone (`modules/checkouts/checkouts.preflight.ts`), with no project check. M2's marking is the data fix. Defence in depth: the one shared place that turns a state's manifests into adapters for a restore treats an adapter whose project is not the state's project exactly as a deleted one. A test: a moved database in an old state reads as removed in preflight and is skipped by the checkout.

## Deferred

| Branch | Reason | Who decides |
|--------|--------|-------------|
| Return the database to the source project's init before a move | The deletion plan's restore-or-skip machinery is the upgrade path; nobody has asked | The user, if a case appears |

## Docs changed

- docs/adr/0005-move-marks-source-states-removed.md: a moved database is marked removed in its old project's states

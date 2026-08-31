# 1. Overview

Testate is a self-hosted tool that gives QA "git for the test database". It runs as one Docker container next to the databases under test, on the same intranet, and never adds code to the application under test. A QA engineer connects a project's databases, takes a state (a data-only snapshot of every connected database), and later checks that state out again with one click or one API call. Around that core sit a table browser and query runner, CSV and XLSX import through saved mappings, row-level diff between states, and a read-only browser for S3, SFTP, and FTP.

This document set is the technical specification. It says how Testate is built. The product requirements document (`../PRD.md`) says what is built and why; where the two disagree, the PRD wins and this set is corrected.

> **Terminology.** Every domain term (project, adapter, state, init state, stash, HEAD, checkout, diff, schema fingerprint, drift, mapping, job, token, sealed value, active key list, deletion plan) is defined in `../PRD.md` §2.2 and mirrored in `../GLOSSARY.md`. This set uses those words and no synonyms. One clash to watch: the product calls a stored connection an *adapter*; the architecture vocabulary also uses *adapter* for a concrete implementation behind a seam. In this set, "adapter" alone means the product entity, and "engine adapter", "store adapter", or "file adapter" means the implementation.

> **Language policy.** UI copy, API fields, identifiers, logs, and documentation are English. Testate is a public image; there is no second UI language.

## 1.1 Goals

| Goal | Measured by |
| --- | --- |
| QA resets a database without a developer | Checkout is one click in the dashboard or one authenticated HTTP call, and finishes without a human on the database host |
| No reset code in the application repository | Testate needs only a database credential; it never calls application endpoints to snapshot or restore |
| A checkout is byte-faithful | The type round-trip contract suite passes on every supported engine and version floor |
| A mistake is reversible | Every checkout, replace import, and write session stashes first; init states are protected forever |
| A production database cannot be hit by accident | Address checks on every outbound connection; admin-only loosening of read-only adapters; typed-slug project deletion that returns every database to init |
| A CI pipeline needs three lines | `POST .../checkouts` with `state_name` and `?wait=`, a bearer token, and an exit code |

## 1.2 Scope by module

Each module below is a vertical slice under `apps/api/src/modules/` (see [05-module-definitions.md](05-module-definitions.md)). Story numbers refer to `../PRD.md` §3.

### 1.2.1 `auth`

In scope: login with lockout, forced password change, session lifecycle, own password change, API tokens with role and project scope, bearer and cookie authentication. Stories 1, 2, 6, 7, 8, 9, 107, 108.

### 1.2.2 `users`

In scope: admin creates, disables, deletes users; temporary passwords with forced change; cumulative roles. Stories 3, 4, 5.

### 1.2.3 `projects`

In scope: create, list, update, slug, HEAD and its status, quota and instance ceiling, project overview, deletion plan and project-delete job. Stories 10 to 16.

### 1.2.4 `adapters`

In scope: database and storage adapters; draft connection test and re-test; probe, capabilities, strategy, version floor; mode changes with admin-only loosening; read-only credential; excluded tables and schemas; init state on connect and on target change; rename; deletion plan and adapter-delete job; address check and deny-list re-check; sealed credentials. Stories 15 to 31, 90, 95.

### 1.2.5 `data`

In scope: table list with counts, grid paging with sort and filter, inline edit in a write session, SQL and MongoDB query forms with limits, session-level read-only enforcement, running queries and cancel, saved queries, query history, result export. Stories 32 to 45.

### 1.2.6 `imports`

In scope: upload or storage-file source, CSV and XLSX parsing with typed cells, mapping editor and saved mappings, transforms, dry run, append, upsert, replace with stash, report with rejected-rows file, re-import of rejected rows, import run list. Stories 46 to 57.

### 1.2.7 `states`

In scope: snapshot job with per-table progress, consistency per adapter, single-adapter init states, unique names, parent and tree, protect, rename, stash retention, state-delete job, archive download and upload with adapter mapping, deduplicated storage, type fidelity, unsupported-type warnings. Stories 58 to 71.

### 1.2.8 `checkouts`

In scope: checkout job, stash first, drift check and force, partial states, per-adapter results and retry, strategy selection from privileges, counters step and repair, atomicity and locking disclosure, lock timeout with blocking sessions, one job per adapter, checkout history, return-to-init for deletions. Stories 72 to 84.

### 1.2.9 `diffs`

In scope: diff between two states or a state and live, per-table counts, row drill-down, export, PK-less tables by row hash, retention. Stories 85 to 89.

### 1.2.10 `storage`

In scope: browse, filter, stat, preview, download on S3, SFTP, FTP; host key trust on first use and blocking on change. Stories 90 to 94.

### 1.2.11 `jobs`

In scope: persisted queue, dispatcher with global cap and per-adapter exclusivity, queue position, server-sent events, `wait`, idempotency keys, cancel with engine-level cancel, boot recovery with HEAD unknown. Stories 101 to 104.

### 1.2.12 `audit`

In scope: audit rows for every listed action, filters, CSV export, retention, rows that outlive their subject. Stories 105, 106.

### 1.2.13 `settings`

In scope: snapshot store choice and migration job, backup job, deny list, retention values, quota defaults, rate limits, upload limit. Stories 114 to 117.

### 1.2.14 `ops`

In scope: health endpoint, reset-state endpoint outside production, boot sequence, pre-migration copy, graceful shutdown, sub-path serving. Stories 118 to 122.

### 1.2.15 `tools`

In scope: stateless hash generator (argon2id, bcrypt, sha256, sha512, hmac with secret, optional salt), random secret generator, UUID v4 and v7 generator. Stories 131 to 133.

### 1.2.16 `agent`

In scope: read-only MCP server for AI agents with agent-kind tokens, masked results, lower caps, fixture extraction, per-call audit. Stories 134 to 139.

### 1.2.17 Editing, policies, and fixtures (inside `data` and `imports`)

In scope: relation view, FK lookups, typed insert and edit forms with functions, bulk insert, foreign-key-checks toggle, column input policies with required functions and masks, sample files from the schema, fixture extraction. Stories 140 to 150. Single source: [24-table-editing.md](24-table-editing.md).

### 1.2.18 Out of scope

Firebase and Firestore; SQLite as a target; snapshot or restore through the application's REST API; schema migrations of the target; Postgres large-object content; MongoDB import and MongoDB write forms (the Document tier is view, state, diff, extract); branches and merges between states; single sign-on, LDAP, email; multi-tenant hosting; metrics and tracing; internationalized UI. See `../PRD.md` §6.

## 1.3 User base

One organization per instance. Tens of users: a handful of admins, QA engineers as the main users, viewers from development and product. CI pipelines as token-holding clients. Databases under test in dev, SIT, and UAT sizes: up to five gigabytes and five hundred tables per adapter is the design target.

## 1.4 Business workflows

```text
admin, first day
  login(bootstrap credentials)            -> forced password change
  create users(qa, viewer)                -> temporary passwords, handed over out of band
  set deny list, quotas, retention        -> settings
  create API token(role=qa, scope=project)

qa, first project
  create project(slug)
  add database adapter(config, mode=sandbox)
    -> address check -> probe (version floor, privileges, strategy) -> save sealed
    -> init state job (single adapter, protected)
  add storage adapter
  run app seed once (outside Testate)
  take state "seeded-baseline" (all adapters, one instant each)
  protect it

qa, every test cycle
  checkout "seeded-baseline"
    -> stash -> drift check -> restore per adapter -> counters -> HEAD moves
  run tests (outside Testate)
  diff "seeded-baseline" vs live          -> what the test changed
  import fixtures.xlsx via saved mapping   -> dry run -> run
  write session for a data fix            -> stash on first write

ci pipeline, every run
  POST /api/v1/projects/shop/checkouts { state_name: "seeded-baseline" } ?wait=300
  run tests
  POST /api/v1/projects/shop/states { name: "run-<id>" }   (only on failure)

admin, retiring a system
  deletion plan(project)                   -> per adapter: restore to init | force | skip
  confirm with slug                        -> restores -> delete only after every restore succeeded
```

## 1.5 Assumptions and known constraints

1. Testate runs on the same intranet as the databases under test and reaches them directly. No tunnel or bastion support.
2. The credential given to Testate is the credential's own responsibility: a `sandbox` adapter with a superuser credential can do what a superuser can do. Testate limits itself by mode and role, not by rewriting privileges.
3. One Testate instance serves one organization. Projects isolate data and scope, not tenants.
4. The application under test owns its schema. Testate detects drift and stops; it never migrates.
5. Snapshots are point-in-time per adapter, not across adapters in a project.
6. The metadata store is SQLite on the container volume. Concurrent instances against one volume are unsupported.
7. Bun's SQL driver has no bulk-copy path and no cursor API. Postgres restore throughput is bounded by batched inserts; Sprint 0 measures it.
8. SolidJS 2.0 is a release candidate. Versions are pinned exactly and bumped on purpose.
9. The engine floors are Postgres 13, MySQL 8.0, MariaDB 10.6, MongoDB 6.0. Below them the probe refuses.
10. MariaDB over Bun's MySQL driver, ssh2 under Bun, OpenAPI generation from valibot, and the MCP transport for Hono are Sprint 0 spikes with fixed fallbacks (`../PRD.md` §7).
11. Adapters belong to a tier that fixes what Testate can do with them: Files (S3, SFTP, FTP: view, download), Document (MongoDB: view, state, diff, extract), Tabular (Postgres, MySQL, MariaDB: view, state, diff, extract, edit, import). Tier is reported by the probe and enforced by every module.

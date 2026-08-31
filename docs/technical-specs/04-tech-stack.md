# 4. Tech Stack

Every choice below was confirmed in the architecture grill on 2026-08-28. Versions marked "verified" were checked on npm that day; the rest are pinned when the scaffold is generated and recorded here in the same commit.

## 4.1 Runtime and language

| Component | Technology | Justification |
| --- | --- | --- |
| Runtime | Bun 1.4.0 (verified) | One runtime for API, jobs, scripts, tests, and bundling. Native `SQL`, `S3Client`, `password`, `randomUUIDv7`, `CompressionStream` |
| Language | TypeScript 7.0.2 (verified), `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax` | Native compiler keeps `type-check` fast on a monorepo; already proven with Solid 2 + Vite 8 in Audionesia |
| Package manager | Bun workspaces | `bun install` never builds ssh2's optional native addon, which crashes under Bun; npm would |
| Module format | ESM only | Bun and Vite defaults |

## 4.2 Backend

| Component | Technology | Justification |
| --- | --- | --- |
| HTTP framework | Hono 4.13.5 (verified) | Small, Bun-native adapter, middleware model fits the wide-event and auth chain |
| Validation | valibot 1.4.2 (verified) at every trust boundary; types via `InferOutput` | Tree-shakable, standard-schema compliant, shared with the SPA through `@testate/shared` |
| OpenAPI | `hono-openapi` 1.3.1 + `@hono/standard-validator` 0.2.x + `@valibot/to-json-schema` 1.7.1 (verified), Scalar UI via `@scalar/hono-api-reference` (pinned at scaffold) | valibot rules out `@hono/zod-openapi`; the standard-schema bridge generates the document from the same schemas the handlers validate with |
| Metadata database | SQLite through `Bun.SQL` (`sqlite://`), WAL, `busy_timeout` 5000 ms | Zero external service; one process; about 28 tables of simple queries |
| Data access | Hand-written SQL in repositories, rows parsed with valibot | No ORM; Drizzle would add a second query language and a build step for nothing |
| Migrations | Numbered `.sql` files, in-house runner at boot, `schema_migrations` ledger | Files resolved relative to `import.meta.dir`, connection from the environment; see 06 §6.9 |
| Target engines | Postgres and MySQL/MariaDB through `Bun.SQL`; MongoDB through `mongodb` 7.6.0 (verified); `mysql2` 3.24.2 as the MariaDB fallback if the Sprint 0 spike fails | Native driver where Bun has one; official driver where it does not |
| Snapshot store | `Bun.S3Client` for S3 and S3-compatible endpoints; local filesystem through `Bun.file` and `Bun.write` | Native, streaming, no SDK |
| Files | `Bun.S3Client` (S3), `ssh2` 1.17.0 + `ssh2-sftp-client` 11.x with the Simulflow `bun patch` (SFTP), `basic-ftp` 6.2.1 (FTP) | Verified pure-JS paths under Bun; the SFTP spike has a fixed fallback |
| CSV and XLSX | `csv-parse` (streaming) and `exceljs` (pinned at scaffold) | Streaming CSV; maintained XLSX reader with typed cells |
| Compression | `CompressionStream("gzip")` and `DecompressionStream` | Web standard, built into Bun, streaming |
| Hashing | `Bun.CryptoHasher("sha256")` | Content addressing, token hashes, row hashes |
| Crypto | WebCrypto AES-256-GCM; `Bun.password` (argon2id) | Sealed values; password hashing |
| Logging | In-house wide-event logger (`lib/logger`) | One event per request and per job, daily file, 30-day retention; see 21 |

## 4.3 Frontend

| Component | Technology | Justification |
| --- | --- | --- |
| Framework | `solid-js` 2.0.0-rc.3 + `@solidjs/web` 2.0.0-rc.3 (verified), pinned exact | Chosen by the owner; fine-grained reactivity, async memos with `Loading` and `Errored` |
| Bundler | Vite 8.2.2 + `@solidjs/vite-plugin` 3.0.0-next.34 (verified) | Bun's bundler cannot compile Solid JSX; the plugin is the only Solid 2 compiler |
| Styling | Tailwind CSS 4.3.3, tokens in a project-owned `@theme` block (verified) | GitHub's design language with hand-rolled Solid components; no component library supports Solid 2 |
| Components | Hand-rolled, one per file, plus data-grid, tree, code-editor, json-viewer, file-tree, command-palette | See the `design-system` skill |
| Code editor | CodeMirror 6 (pinned at scaffold) wrapped in one component | Framework-agnostic, SQL and JSON modes, keymaps |
| Router | In-house `lib/router.ts` over the history API | The Solid 2 line of `@solidjs/router` is a prerelease; the one deliberate shortcut in the plan |
| State | Signals and stores in presenters; module-level signals for session and navigation | No global state library |
| Forms | Presenter-held stores validated with `@testate/shared` schemas on submit | No form library supports Solid 2 |
| Live updates | `EventSource` wrapper in `lib/sse.ts` | Job progress; no WebSocket needed |

## 4.4 Datastores

| Store | Location | Contents | Backup |
| --- | --- | --- | --- |
| Metadata | `${TESTATE_DATA_DIR}/metadata.db` (SQLite, WAL) | Every entity in 06 | Backup job; pre-migration copy at boot |
| Snapshot store | `${TESTATE_DATA_DIR}/blobs/` or S3 prefix | Content-addressed gzip blobs, manifests | Backup job (optional blobs); volume snapshot |
| Logs | `${TESTATE_DATA_DIR}/logs/` | Daily wide-event files, 30 days | None; operational |
| Uploads | `${TESTATE_DATA_DIR}/uploads/` | Import files during a job | Deleted when the job ends |
| Import artifacts | `${TESTATE_DATA_DIR}/imports/<run>/` | Rejected-rows CSV | Import-run retention sweep |
| Boot files | `${TESTATE_DATA_DIR}/run/` | Base-path-rewritten SPA, metadata copies | Overwritten each boot; copies kept for the last three boots |

## 4.5 Security

| Concern | Technology |
| --- | --- |
| Sealed values | AES-256-GCM, 96-bit random nonce, key list from `TESTATE_SECRETS_ACTIVE_KEY`, key fingerprint per record |
| Passwords | `Bun.password.hash` argon2id defaults, minimum length 12 |
| Sessions | Opaque 256-bit random token, SHA-256 at rest, HTTP-only `SameSite=Strict` cookie |
| API tokens | `tst_` prefix, 256-bit random, SHA-256 at rest, constant-time compare |
| CSRF | Same-site cookie plus `X-Testate-Request: 1` header check on every mutating cookie request |
| Outbound | `lib/netguard` resolve-and-check on every physical connection |
| Container | Non-root user, read-only root filesystem, `/data` the only writable mount |

## 4.6 Testing and CI

| Layer | Technology |
| --- | --- |
| Unit | `bun test`, Arrange-Act-Assert, pure modules only, no module mocking |
| API | Hono `app.request()` in-process with the fake engine and a temporary metadata database |
| Contract | The engine and file contract suites against `deploy/compose.engines.yml` (Postgres 13 and 17, MySQL 8.0 and 8.4, MariaDB 10.6 and 11, MongoDB 6 and 8, MinIO, SFTP, FTP) |
| Smoke | Playwright 1.62.1 driving the built app (`scripts/smoke.ts`) |
| Lint and format | oxlint 1.80.0 + `@oxlint/plugins` 1.80.0 + vendored anti-slop + `eslint-plugin-solid` 0.16.1 (v2 rules) + `jest` plugin; oxfmt 0.65.0 (verified) |
| Hooks | lefthook 2.1.10 (verified): format staged, lint staged, type-check on commit; conventional commit message check |
| CI | GitHub Actions `ci.yml` on every push: fmt, lint, type-check, unit, API, build. On a pull request, a version tag or on demand it also runs the engine contract suites (`bun run contract`, which fails on a skipped suite), the browser suite, and the image build. There is no dependency scan yet. `deploy-image.yml` on manual dispatch: skips a published `package.json` version, builds the fat image, profiles it with docker-slim while it boots and answers the health probes, pushes `<version>` and `latest` to GHCR |

## 4.7 Deployment

| Component | Technology |
| --- | --- |
| Image | `oven/bun:1.4-slim` runtime stage, `ghcr.io/pt-perkasa-pilar-utama/testate:<semver>` and `:latest` |
| Process | `bun dist/index.js`, port 7378, `SIGTERM` graceful shutdown |
| Reverse proxy | nginx example in `deploy/nginx.conf`; any proxy that forwards `X-Forwarded-Proto` and `X-Request-Id` works |
| Orchestration | docker compose example; no cluster mode |

## 4.8 What we deliberately do not use

| Not used | Reason |
| --- | --- |
| Node, npm, pnpm, yarn | Bun project; npm would compile ssh2's native addon, which crashes under Bun |
| Drizzle, Prisma, Kysely | 28 simple tables; an ORM adds a second query language for no query complexity |
| Zod | valibot is the schema library; one library on both sides |
| `@hono/zod-openapi` | Zod-only |
| `hono-wide-logger`, pino, winston | Package covers the HTTP half only; the in-house logger handles jobs, files, and rotation |
| zaidan, Kobalte, Corvu, shadcn-solid, solid-ui | Solid 1.x only |
| `@solidjs/router` | Solid 2 line is a prerelease; in-house router until it ships |
| Redis, RabbitMQ, any queue | One process; the dispatcher runs in-process over SQLite |
| `pg_dump`, `mysqldump`, `mongodump` binaries | Data-only snapshots through the engine port keep the image slim and engine-version agnostic |
| Mutation testing (Stryker) | No runner support for `bun test`; the break-it-once author check stands in |
| Express, Fastify, Elysia | Hono chosen |
| Docker in development for the app itself | `bun run dev` runs natively; compose is for target engines only |

## 4.9 Version pinning policy

- `package.json` pins exact versions for everything under `apps/` and `packages/`. No `^` or `~`.
- Solid 2.0 packages move together: `solid-js`, `@solidjs/web`, and `@solidjs/vite-plugin` are bumped in one commit after the smoke run passes.
- Engine drivers (`mongodb`, `ssh2`, `basic-ftp`) are bumped only after the contract suite passes on the CI matrix.
- The Docker base image tag is `oven/bun:1.4-slim`; a minor Bun bump is a pull request that runs the full matrix.
- `tools/oxlint/anti-slop` is updated by copying upstream, never edited.

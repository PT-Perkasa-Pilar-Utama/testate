# 3. Repository Structure

## 3.1 Layout

A Bun workspace monorepo with two apps and one shared package. The API and the SPA have different build tools and different `tsconfig` targets (Bun types versus DOM), which is the reason for `apps/`.

```
testate/                                  # github.com/pt-perkasa-pilar-utama/testate, MIT
├── apps/
│   ├── api/                              # Hono API + job dispatcher, one Bun process
│   │   ├── src/
│   │   │   ├── index.ts                  # composition root: app, middleware, job kinds, listen
│   │   │   ├── modules/                  # vertical slices (see 05)
│   │   │   │   ├── auth/                 # auth.router.ts, auth.handler.ts, auth.service.ts, auth.repository.ts, auth.schema.ts, auth.test.ts
│   │   │   │   ├── users/
│   │   │   │   ├── projects/
│   │   │   │   ├── adapters/
│   │   │   │   ├── data/                 # split by concern: data.rows.*, data.query.*, data.session.*
│   │   │   │   ├── imports/              # imports.csv.ts, imports.xlsx.ts, imports.transforms.ts, imports.job.ts
│   │   │   │   ├── states/               # states.snapshot.job.ts, states.archive.ts, states.retention.ts
│   │   │   │   ├── checkouts/            # checkouts.plan.ts, checkouts.job.ts, checkouts.return-to-init.ts
│   │   │   │   ├── diffs/
│   │   │   │   ├── storage/
│   │   │   │   ├── rest/
│   │   │   │   ├── hooks/
│   │   │   │   ├── jobs/                 # jobs.dispatcher.ts, jobs.events.ts (SSE), jobs.recovery.ts
│   │   │   │   ├── audit/
│   │   │   │   ├── settings/             # settings.store-migration.job.ts, settings.backup.job.ts
│   │   │   │   ├── ops/                  # health, reset-state (non-production), seeds/dev.ts, seeds/qa.ts
│   │   │   │   ├── tools/                # hash, random secret, uuid (stateless)
│   │   │   │   └── agent/                # MCP server: read tools and resources, agent-token guard
│   │   │   ├── lib/
│   │   │   │   ├── engines/              # DbEngine port (ADR 0001): index.ts, types.ts, pure/*.ts,
│   │   │   │   │   ├── postgres/         #   engine.ts, probe.ts, codec.ts, cancel.ts, reader.ts, restore.ts
│   │   │   │   │   ├── mysql/            #   same layout, dialect branches for MariaDB
│   │   │   │   │   ├── mongodb/
│   │   │   │   │   └── fake/             #   in-memory engine for API tests
│   │   │   │   ├── blobstore/            # port + local/, s3/, memory/
│   │   │   │   ├── files/                # port + s3/, sftp/, ftp/, memory/
│   │   │   │   ├── snapshot/             # ndjson codec, manifest, merge (diff), tar (PAX writer)
│   │   │   │   ├── sealed/               # envelope, key list, sweep, banners, registry.ts (sealed columns)
│   │   │   │   ├── netguard/             # address check, deny list matching
│   │   │   │   ├── logger/               # wide events, sink, rotation
│   │   │   │   ├── http/                 # envelope, errors, pagination, auth middleware, rbac, rate limit, csrf
│   │   │   │   ├── config/               # env parsing with valibot
│   │   │   │   └── db/                   # SQLite client, migration runner
│   │   │   └── db/
│   │   │       └── migrations/           # 0001_init.sql ... applied at boot, resolved via import.meta.dir
│   │   ├── test/                         # API tests (Hono in-process + fake engine), contract suite (compose)
│   │   ├── package.json
│   │   └── tsconfig.json                 # types: ["bun"]
│   └── web/                              # SolidJS 2.0 SPA (Vite)
│       ├── index.html
│       ├── src/
│       │   ├── main.tsx  app.tsx  routes.ts
│       │   ├── features/<feature>/       # <feature>.model.ts, <feature>.presenter.ts, <feature>.view.tsx
│       │   ├── components/               # hand-rolled Kumo components, one per file
│       │   ├── lib/                      # api-client.ts, router.ts, sse.ts, session.ts
│       │   └── styles/app.css            # @import "tailwindcss" then Kumo tokens
│       ├── test/                         # presenter and lib unit tests (bun test, no DOM)
│       ├── vite.config.ts                # base: "/__TESTATE_BASE__/"
│       ├── package.json
│       └── tsconfig.json  tsconfig.node.json
├── packages/
│   └── shared/                           # @testate/shared: valibot schemas, enums, error codes, InferOutput types
│       └── src/
│           ├── schemas/<resource>.ts     # request and response schemas per API resource
│           ├── enums.ts                  # roles, job types and statuses, engines, error codes
│           └── index.ts
├── deploy/
│   ├── docker-compose.yml                # testate + volume; nginx optional profile
│   ├── nginx.conf                        # upload size, read timeout above the wait ceiling, SSE headers
│   ├── compose.engines.yml               # CI matrix: pg 13/17, mysql 8.0/8.4, mariadb 10.6/11, mongo 6/8, minio, sftp, ftp
│   └── .env.example
├── docs/                                 # PRD, technical-specs/, api-specs/, adr/, CODING_STANDARD, ...
├── scripts/
│   ├── smoke.ts                          # Playwright smoke against bun run dev
│   ├── generate-key.ts                   # prints a base64 32-byte key for TESTATE_SECRETS_ACTIVE_KEY
│   └── contract.ts                       # runs the engine contract suite against compose.engines.yml
├── tools/oxlint/anti-slop/               # vendored lint rules, never edited
├── .claude/skills/                       # solidjs-2, kumo-design, wide-event-logging, and the codebase-pattern skills
├── .github/workflows/                    # ci.yml (quality + contract matrix), release.yml (image on tag)
├── Dockerfile                            # multi-stage: build web + bundle api, slim runtime, non-root, /data volume
├── lefthook.yml  .oxlintrc.json  .oxfmtrc.json  bunfig.toml
├── package.json                          # workspaces, root scripts (complete-check)
├── tsconfig.base.json
├── LICENSE                               # MIT
└── README.md
```

## 3.2 Folder purposes

| Path | Purpose | Rule |
| --- | --- | --- |
| `apps/api/src/modules/<m>/` | One feature, all layers | Six files minimum; split by concern (`<m>.<concern>.ts`) past 250 lines; never a `utils` bucket |
| `apps/api/src/lib/` | Infrastructure shared by modules | Never imports a module |
| `apps/api/src/db/migrations/` | Numbered SQL applied at boot | Resolved relative to `import.meta.dir`; never an absolute path |
| `apps/api/test/` | API tests and the contract suite | API tests use the fake engine; the contract suite uses real engines only |
| `apps/web/src/features/<f>/` | One feature in MVP form | View is JSX only; presenter owns state; model calls the API |
| `apps/web/src/components/` | Kumo components | Never imports `features/` |
| `packages/shared/` | The API contract as valibot schemas | Both apps derive types from it; no runtime logic beyond validation |
| `deploy/` | Everything an operator copies | Compose, nginx, env example |
| `docs/adr/` | Decisions with alternatives | One file per decision, numbered |
| `tools/oxlint/anti-slop/` | Vendored rules | Byte-identical to upstream; update by copying |

## 3.3 Build outputs

| Command | Output | Used by |
| --- | --- | --- |
| `bun run build:web` | `apps/web/dist/` with `/__TESTATE_BASE__/` baked into asset URLs | Dockerfile, copied to `/app/web` |
| `bun run build:api` | `apps/api/dist/index.js` (single file, `--target=bun`) plus `dist/migrations/*.sql` copied alongside | Dockerfile, `CMD ["bun", "dist/index.js"]` |
| `bun run dev` | Vite on `:5173` proxying `/api` to the API on `:3000` (`bun --hot`) | Development |

The runtime image carries `dist/`, `web/`, and the production `node_modules` for the API only. No TypeScript sources, no dev dependencies, no docs.

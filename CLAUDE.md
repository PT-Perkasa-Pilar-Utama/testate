# Testate

Git for your test database. Bun 1.4 monorepo: `apps/api` (Hono), `apps/web` (SolidJS 2 RC), `packages/shared` (valibot contract). Read `docs/technical-specs/_index.md` before changing architecture; cite the spec section in the commit body.

## Commands

| Task                                  | Command                                                                                                     |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Full gate (run before every hand-off) | `bun run complete-check`                                                                                    |
| Tests                                 | `bun test` or `bun test apps/api/src/modules/states`                                                        |
| Lint and format                       | `bun run lint`, `bun run fmt:fix`                                                                           |
| Dev servers                           | `bun run dev` (API :7378, Vite :7379 proxying `/api`)                                                       |
| Smoke a running API                   | `bun run smoke`                                                                                             |
| Seed a dev instance with the demo     | `bun run seed:dev [url]` (wipes it; needs the compose engines; bootstrap read from `apps/api/.env`)         |
| Wipe the dev environment              | `bun run reset:dev --yes [--engines]` (stop `bun run dev` first; `--engines` also rebuilds the demo schema) |
| Browser end-to-end (Playwright)       | `bun run e2e` (its own ports 7478/7479, so it runs beside `bun run dev`)                                    |
| Engine contract suites                | `bun run contract` (needs the compose engines; fails on a skip)                                             |
| Set the version everywhere            | `bun run bump-version <version>` (`--check` reports drift)                                                  |

The gate is green today. Keep it green: a change that adds a lint error or a failing test is not done.

## Where things go

| Concern                                  | Place                                                       | Never                                                     |
| ---------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------- |
| Request schemas, response schemas, enums | `packages/shared/src`                                       | Define a shape twice; derive types with `v.InferOutput`   |
| HTTP routes                              | `modules/<name>/<name>.router.ts`                           | Logic in a router or in `modules/index.ts`                |
| Parsing, status codes, envelopes         | `modules/<name>/<name>.handler.ts` with `lib/http` helpers  | `c.json` by hand for errors; use `AppError` subclasses    |
| Business rules                           | `modules/<name>/<name>.service.ts` (`createXService(deps)`) | Reading `process.env`; `lib/config` is the only reader    |
| SQL                                      | `modules/<name>/<name>.repository.ts`                       | SQL in a service                                          |
| Typed mock data                          | `modules/<name>/<name>.mock.ts`                             | `as const` mocks; type them with the schema's output type |
| SPA data access                          | `features/<name>/<name>.model.ts` via `lib/api-client.ts`   | `fetch` anywhere else                                     |
| SPA state                                | `features/<name>/<name>.presenter.ts`                       | Logic in JSX                                              |
| SPA markup                               | `features/<name>/<name>.view.tsx` with `components/`        | A component importing `features/`                         |

Composition root: `apps/api/src/index.ts` wires services and handlers; `modules/index.ts` mounts routers. Both are wiring only.

## Rules the linter enforces

- Cyclomatic complexity 10 per function. Split; never `oxlint-disable complexity`.
- 300 lines per file.
- No `any`, no `!`, no `as` without a `// SAFETY:` line above it, no `Record<string, unknown>` (use `JsonObject`), no `typeof` narrowing (parse with valibot), no `object` or `unknown` parameters, no `mock.module()`.
- Tests: no conditionals, no `expect` outside a test, every `toThrow` has a message.
- Solid: two-argument `createEffect`, props read inside JSX or tracked scopes, `class` as string or structured array.

Read the rule text in `docs/CODING_STANDARD.md` when a rule fires; do not reformulate code to dodge it.

## Rules the reviewer enforces

- **Tautological tests considered harmful.** A test must fail when the behaviour it names breaks. Break the implementation once and watch it fail before committing. `test/contract.ts` `expectContract` needs a `breakIt` that makes the mock invalid.
- Trust boundaries parse with valibot: request bodies, queries, params, env, engine rows, MCP arguments.
- Secrets are `Sealed` values; the logger refuses the keys `password`, `token`, `secret`, `connection_string`. Never log a credential, a session cookie, or a bearer token.
- `requireRole` on every non-public route; agent tokens reach `/mcp` only.
- A deliberate shortcut carries `// ponytail: <what>. <ceiling>; <upgrade path>`. `grep ponytail:` lists them. `// SCAFFOLD:` marks mock-backed code the next card replaces.
- One wide event per request or job (`.claude/skills/wide-event-logging`). Add fields to the event; do not add log lines.
- The SPA never shows an API message raw. Every caught failure goes through `humanMessage` in `lib/api-error.ts`, which replaces the codes that say nothing a person can act on and passes the rest through as a sentence. Four screens keep the technical text on purpose (query console, checkout outcome, adapter probe, a malformed query) and each says so in a comment.

## Workflows

| Want to                       | Use                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Add or change an endpoint     | `.claude/skills/add-api-endpoint/SKILL.md`                                                                                |
| Add a screen                  | `.claude/skills/add-frontend-feature/SKILL.md`                                                                            |
| Add an engine                 | `.claude/skills/add-db-adapter/SKILL.md`                                                                                  |
| Write Solid 2 code            | `.claude/skills/solidjs-2/SKILL.md`                                                                                       |
| Style a screen or a component | `.claude/skills/design-system/SKILL.md`; reuse `PageHeader`, the `table.tsx` parts, `Menu`, `ConfirmDialog`, `formatWhen` |
| Review a change               | `docs/CODE_REVIEW_CHECKLIST.md`                                                                                           |

## Do not

- Push, force-reset, or clean the working tree; a global hook blocks these.
- Commit unless asked. Conventional Commits, 80-character subject.
- Add a dependency for what `Bun`, the standard library, or an installed package does.
- Register `POST /admin/reset-state` in production. `TESTATE_ENV` is the only gate.
- Widen a mock to make a test pass. Fix the schema or the code.

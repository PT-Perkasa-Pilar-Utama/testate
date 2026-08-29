# Browser end-to-end tests

`bun run e2e` runs Playwright against a fresh API (`.e2e/data`) and the Vite dev server. Compose
engines must be up (`docker compose up --wait`).

## Layout

| Project    | Spec                                  | What it proves                                                     |
| ---------- | ------------------------------------- | ------------------------------------------------------------------ |
| `coverage` | `e2e/coverage.e2e.ts`                 | Every `@story-N` tag names a PRD story; writes `.e2e/coverage.md`  |
| `routes`   | `e2e/routes.e2e.ts`                   | Each screen renders or refuses per role; sidebar matches the role  |
| `flows`    | `e2e/flows.e2e.ts`, `stories.e2e.ts`  | One test per user story that the dashboard can act on              |
| `crawl`    | `e2e/buttons.e2e.ts`                  | Clicks every visible control per role; no 5xx, no console error    |

Projects run in that order (`dependencies`), tests inside a project run on 3 workers.
`e2e/setup.ts` seeds `dev` once and saves one storage state per role under `.e2e/state`.

## Story tags

Put `@story-N` in the test title. `.e2e/coverage.md` lists each PRD story as `covered`,
`no-screen` (the SPA has no action for it yet; see `NO_SCREEN` in `e2e/lib/stories.ts`),
`api` (CI, operator, agent stories live in `bun test`), or `uncovered`.

## Rules

- Never wipe data in `playwright.config.ts`; it runs in every worker.
- The Vite proxy targets `127.0.0.1`; Node resolves `localhost` to `::1`.
- The crawler skips `Sign out`, `Disable`, `Revoke`, `Delete`, and other destructive labels
  (`SKIP` in `e2e/lib/crawl.ts`); story tests cover those on purpose.

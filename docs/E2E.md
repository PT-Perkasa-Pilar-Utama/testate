# Browser end-to-end tests

`bun run e2e` runs Playwright against a fresh API (`.e2e/data`) and the Vite dev server. Compose
engines must be up (`docker compose -f deploy/compose.engines.yml up --wait`).

**The engines also need their schema.** A fresh stack brings up an empty `shop` on every engine,
and the seeded demo adapters introspect zero tables from it, which fails a third of the suite with
"adapter ... has no tables". The tables are created by the contract suites, so run them once after
starting a fresh stack:

```sh
docker compose -f deploy/compose.engines.yml up -d --wait
docker compose -f deploy/compose.engines.yml run --rm minio-init
bun run contract        # creates the schema the demo adapters read
bun run e2e
```

Each suite drops and recreates its own schema, so repeating it is harmless. A long-lived stack
already holds the schema, which is why this only bites a fresh checkout or CI.

**The engines publish below port 32768 on purpose.** Linux hands out ephemeral ports from 32768
upwards, so a host port above that can be held by an unrelated outgoing connection at the moment
Docker tries to bind it, and the container fails to start with "address already in use". macOS
starts its ephemeral range at 49152, which is why this only ever failed in CI.

## Layout

| Project     | Spec                                                            | What it proves                                                       |
| ----------- | --------------------------------------------------------------- | -------------------------------------------------------------------- |
| `coverage`  | `e2e/coverage.e2e.ts`                                            | Every `@story-N` tag names a PRD story; writes `.e2e/coverage.md`     |
| `routes`    | `e2e/routes.e2e.ts`                                              | Each screen renders or refuses per role; sidebar matches the role     |
| `api`       | `e2e/api.e2e.ts`, `agent.e2e.ts`                                 | Contract, token, and MCP stories over `request`; no browser           |
| `flows`     | `e2e/flows.e2e.ts`, `stories`, `gaps`, `admin`, `jobs`           | One test per user story the dashboard can act on                      |
| `states`    | `e2e/states.e2e.ts`                                              | Snapshot, checkout, and diff stories; serial, alone, after flows      |
| `state-api` | `e2e/state-api.e2e.ts`                                           | State and job stories with no control of their own; holds the adapters |
| `adapter`   | `e2e/adapter.e2e.ts`                                             | Adapter settings and deletion (init snapshot, restore)                |
| `crawl`     | `e2e/buttons.e2e.ts`                                             | Clicks every visible control per role; no 5xx, no console error       |
| `screens`   | `e2e/screens.e2e.ts`                                             | README screenshots off the seeded demo; skipped unless `SHOTS=1`      |
| `stress`    | `e2e/stress.e2e.ts`                                              | Hunts the reactive-loop warning on the grid; skipped unless `STRESS=1` |
| `bundle`    | `e2e/bundle.e2e.ts`                                              | The built bundle, not Vite: every screen settles and none crashes      |
| `boot`      | `e2e/boot.e2e.ts`, `engine`, `types`, `session`, `storage`       | Stories that need their own instance, engine, or clock                |

Projects run in that order (`dependencies`), tests inside a project run on 3 workers.
`e2e/setup.ts` seeds `dev` once and saves one storage state per role under `.e2e/state`.

## Instances of their own

The `boot` project spawns API processes (`e2e/lib/boot.ts`, ports 3101-3113), each on its own data
dir, and drives them through `e2e/lib/instance.ts`. It runs last on purpose: those processes beside
the browser projects starve the crawl. Rules that keep it honest:

- Stop the instance in `test.afterAll`, never only at the end of the test. A failure otherwise
  leaves the port bound, and the next run wipes that instance's data dir under it.
- Give each spec its own port and its own `bootDir` name.
- Reach for a private database (`e2e/lib/sql.ts`) rather than the shared `shop` one. `createDatabase`
  and `dropDatabase` bracket every test that writes DDL, holds a lock, or breaks a restore.
- `scripts/e2e-sql.ts` and `scripts/e2e-sqlite.ts` run the statements under Bun, because Playwright
  runs under Node and has no driver. `scripts/e2e-xlsx.ts` writes a workbook with real styles.

## Story tags

Put `@story-N` in the test title. `.e2e/coverage.md` lists each PRD story as `covered`,
`no-screen`, `api`, or `uncovered`. 142 of the 144 stories in `docs/PRD.md` are `covered`, and
both exception lists in `e2e/lib/stories.ts` are empty. Add an id back only when a story truly
cannot be exercised.

## Rules

- Never wipe data in `playwright.config.ts`; it runs in every worker.
- The Vite proxy targets `127.0.0.1`; Node resolves `localhost` to `::1`.
- The crawler skips `Sign out`, `Disable`, `Revoke`, `Delete`, and other destructive labels
  (`SKIP` in `e2e/lib/crawl.ts`); story tests cover those on purpose.
- Lint applies jest rules here: no conditionals in a test, `?.` and `??` included. Put the logic in
  `e2e/lib` and assert on what it returns.
- A row's actions live behind its overflow menu. Open it with `rowMenu(row)`; the trigger is a
  `button[aria-haspopup=menu]`, not the `<details>` group it used to be. The panel renders in the
  top layer but stays a child of the row, so the row is still what you query.
- Name matching is a substring by default, and an accessible name is more than the label: a
  `<select>` carries its options and a menu button carries the row it belongs to. `Create` matched
  the `Created` sort header, `Table` matched `What happens`, and `Edit` matched
  `More actions for edit-<stamp>`. Reach for `{ exact: true }` before assuming the screen changed.
- Signing in is deliberately expensive (argon2id, 64 MiB, two passes). Three workers logging in
  at once beat the default five-second timeout, so a post-login assertion carries its own.
- A filter panel opens from a `Filters` toggle. Four empty boxes over every list was a row of the
  page spent on nothing, so nothing filterable shows its filters until asked.
- Iterate with `bunx playwright test --project=<name> --no-deps`; the full chain is for the gate.

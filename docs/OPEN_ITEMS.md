# Open items

What is known and not done, with what has been ruled out. Read `CLAUDE.md` first, then
`docs/E2E.md`. A closed item leaves this file; git history keeps the rest.

## Owed before beta

- **The blob leak on project delete.** Deleting a project drops its states but nothing sweeps the
  blobs they alone pinned, so the disk keeps them. `states.repository` already computes orphans
  for a state delete; a project delete does not ask.
- **`1.0.0-alpha` is still pullable from ghcr and cannot boot.** docker-slim dropped `/data`, so a
  first run against an empty volume refuses. Deleting a published package version needs a scope
  an agent does not have; the owner runs it.
- **The deploy leaves `staging-*` tags on the package.** Harmless, visible, prunable.
- **The Solid patch has an expiry.** `patches/@solidjs%2Fsignals@2.0.0-rc.4.patch` is superseded
  by `solidjs/solid#3143`, merged to `next` as `28a1eaff`, with `solidjs/solid#3148` still open
  for the complementary `initTransition` guard. npm is still on `rc.4`, so the patch stays until a
  release carries it; `docs/upstream-solid-flush-loop.md` holds the evidence.
- **Mobile responsiveness has never been looked at.** Every spec runs at 1440x1000. Audit before
  touching CSS: a Playwright project at 390x844 that walks every screen and asserts the body does
  not scroll sideways and the crash banner is absent. Expect the fixed sidebar, the wide tables,
  the two-column dialog forms, the diff split pane, the ERD canvas and the states tree to break,
  in roughly that order.

## Decisions beta forces (do not settle alone)

- `/api/v1/docs` and `/api/v1/openapi.json` answer without a token. Fine for alpha; a deliberate
  choice for beta, since it advertises every endpoint on a reachable box.
- The `ponytail:` shortcuts stand (`grep -rn "ponytail:" apps packages e2e scripts`). Each names
  its own ceiling. Beta is when someone decides which stop being acceptable.
- The three README limits are the product boundary, not bugs: databases restore one after
  another, Testate only touches what you add, microservices are untested.

## Ways of working that were learned the hard way

- Run one background shell per iteration; never a polling loop. Never edit `apps/web` while a
  browser chain runs (Vite hot-reloads into the crawl), and never `pkill -f vite`: the suite's own
  dev server matches. Kill by the PID you saved.
- Reproduce API bugs against an instance on the suite's data:
  `PORT=7380 TESTATE_ENV=development TESTATE_DATA_DIR=.e2e/data TESTATE_SECRETS_ACTIVE_KEY=$(cat .e2e/key.txt) TESTATE_ADMIN_PASSWORD=admin-password-1234 bun apps/api/src/index.ts`,
  then sign in as `admin` / `admin-final-password-1`. Writes need the `X-Testate-Request: 1`
  header.
- A Solid diagnostic with no stack: wrap `console.warn` in a Playwright `addInitScript` and print
  `new Error().stack` for the matching code. That is how the dialog diagnostics were found.
- The local `bun test` transpiles JSX with the React runtime when run from the repo root; when CI
  disagrees with a green local gate, suspect resolution before logic.
- `max-lines` 300 and `complexity` 10 fire on a file or function that grows a little; split early.
  `??` and `?.` count as conditionals inside a `test()`.

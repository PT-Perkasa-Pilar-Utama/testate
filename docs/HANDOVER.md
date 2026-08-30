# Handover: Testate build session, 2026-08-28 to 2026-08-30

Read this first, then `CLAUDE.md`, then `docs/E2E.md`. Memory notes live in
`~/.claude/projects/-Users-vexeee-Documents-project-testate/memory/` (auto-loaded via `MEMORY.md`).

## 1. What Testate is and where it stands

"Git for your test database". Bun 1.4 monorepo: `apps/api` (Hono), `apps/web` (SolidJS 2 RC),
`packages/shared` (valibot contract). Every PRD card is built and committed on `main`. Nothing is
pushed; the user pushes. There is no open feature work, only ceilings marked `// ponytail:` (12
left; `grep -rn "ponytail:" apps packages e2e scripts`).

E2E: ~120 Playwright tests, ~3 min, coverage **150/150 stories covered**. `NON_UI` in
`e2e/lib/stories.ts` is empty: what no screen shows, an API or boot test covers.

The version is `1.0.0-alpha`. It lives in the root `package.json`, which the release workflow tags
the image with, and `bun run bump-version <version>` writes it into the four `package.json` files
and `apps/api/src/version.ts` at once. `bun run bump-version --check` reports drift, and
`version.test.ts` fails the gate on it.

## 2. Standing rules from the user (do not relitigate)

- Never add `Co-Authored-By: Claude` or "Generated with Claude Code" to commits or PRs.
- Commit finished, gate-green work on your own. Never push (a global hook blocks it anyway).
- Commit subject ≤ 80 characters, and leave a blank line before the body. The heredoc form
  glues them together otherwise and `git log --oneline` shows the whole paragraph.
- No new dependencies for what Bun, the standard library, or an installed package does.
- Roles admin/qa/viewer are cumulative; agent tokens reach `/mcp` only. Secrets are `Sealed`.
- Keep the gate green: `bun run complete-check` then `bun run e2e`. A `pre-push` hook runs
  `complete-check` for you and prints each step as it goes, so nothing reaches CI with a formatting
  or lint slip. It skips when a push carries no changed files. `lefthook validate` is worth running
  after editing `lefthook.yml`: v2 dropped `follow` and `skip_empty`, and an unknown key is ignored
  in silence.
- Talk like a colleague at a whiteboard: answer first, short sentences, no process narration.

## 3. The working loop that works

One background shell per iteration, never polling loops:

```
bun run complete-check > $S/gate.log 2>&1 || { echo GATE FAIL; exit 1; }
bunx playwright test --reporter=line > .e2e/run.log 2>&1 || { echo E2E FAIL; tail -3 .e2e/run.log; exit 1; }
git add -A && git commit -q -F - <<'EOF' ... EOF
```

Run it with `run_in_background: true` and act on the completion notification. Do **not** write
`until pgrep -f "playwright test"; do sleep; done`: `pgrep -f` matches its own shell and loops
forever.

While iterating on one spec, `bunx playwright test --project=<name> --no-deps` skips the whole
dependency chain: the `boot` project alone runs in ten seconds instead of two minutes.

Two rules while a chain runs: never edit `apps/web` (Vite hot-reloads into the crawl), and
remember `git add -A` at the end sweeps every edit into that commit, so park unrelated new files
outside the repo until it lands.

On failure read `.e2e/run.log` and the snapshot under `.e2e/results/<test>/error-context.md`.
Reproduce API bugs directly:

```
PORT=3001 TESTATE_ENV=development TESTATE_DATA_DIR=.e2e/data \
TESTATE_SECRETS_ACTIVE_KEY=$(cat .e2e/key.txt) TESTATE_ADMIN_PASSWORD=admin-password-1234 \
bun apps/api/src/index.ts &   # login admin/admin-final-password-1, PATCH /settings {"netguard":{"deny":[]}}
sqlite3 .e2e/data/metadata.db   # jobs, states, checkouts, import_runs ...
```

`E2E_NET=1` logs every API response to `.e2e/net.log`.

## 4. E2E layout and gotchas (all learned the hard way)

Projects: `coverage`, `routes`, `api` run first; then `flows → states → state-api → adapter →
crawl → boot`. The chain after `flows` is serial because checkouts, snapshots, and adapter
deletion restore the shared demo databases.

- `api.e2e.ts` and `agent.e2e.ts`: contract and MCP stories over `request`, no browser.
- `state-api.e2e.ts`: state, job, and checkout stories that hold the demo adapters.
- `boot.e2e.ts`, `engine.e2e.ts`, `types.e2e.ts`, `session.e2e.ts`, `storage.e2e.ts`: each
  spawns its own API instance (`e2e/lib/boot.ts`, ports 3101-3113) on its own data dir, and
  drives it through `e2e/lib/instance.ts`. They run **last**: spawning API processes beside the
  browser projects starved the crawl and took a two-minute run to sixteen minutes.
- Spawned instances must stop in `test.afterAll`, not at the end of the test: a failure otherwise
  leaves the port bound, and the next run wipes that instance's data dir under it.
- `e2e/lib/sql.ts` runs SQL on a private Postgres database per test (`scripts/e2e-sql.ts`, Bun,
  because Playwright runs under Node) and on an instance's `metadata.db`
  (`scripts/e2e-sqlite.ts`). Nothing in those specs touches the shared `shop` database.
- Tag every test title with `@story-N`; `coverage.e2e.ts` fails on a tag that names no story.
- Lint applies jest rules to `e2e/`: no conditionals in tests, so no `?.`, no `??`, no ternary.
  Put the logic in `e2e/lib` and return a value the test can assert on.
- Crawler (`buttons.e2e.ts`) clicks every visible control; mutators go in `SKIP` in
  `e2e/lib/crawl.ts` and get a story test instead.
- Demo tables live in schema `contract` (not `public`). `getByLabel("X")` also matches option
  text, so use `getByRole("combobox", { name })`. Count only your own rows.
- Never wipe data in `playwright.config.ts`; it runs in every worker.
- `screens.e2e.ts` writes the README screenshots, and only when `SHOTS=1`:
  `SHOTS=1 bunx playwright test --project=screens` runs the chain up to `state-api` and shoots
  `docs/assets/screens/*.png`. It trims the empty page under the content by measuring `main`, and
  it makes what it shoots first: a diff, a run query, two readably named states. Re-run it after a
  screen changes and commit the PNGs.

## 5. Contract and product bugs this suite found

The pattern to expect: the contract says one thing, a path does another.

- `GET /settings` answered 500 while another request saved the S3 credentials: the sealed key
  landed before its `set_at`. Fixed with `setMany` in one transaction.
- The log sink wrote from offset zero, so every restart overwrote the day's earlier events.
- A forced checkout wrote NULL into a live-only NOT NULL column instead of leaving it to its
  default, though the plan already called it `defaulted`.
- The pre-migration copy (story 122, spec 22 §22.2) was never implemented.
- Postgres introspection never named an unsupported column type (story 73).
- XLSX date cells read as their serial number (story 50).
- A retried `POST /states` was refused as a duplicate name and a retried `POST /checkouts` made a
  second row: only adapter deletion honoured `Idempotency-Key`.
- Earlier: `""` where the contract said id, a `text/plain` diff export, a dry run that deleted its
  upload, `Bun.write(path, new Response(stream))` stalling on a pull stream.

## 6. Commits of this session (newest first)

```
662c3fb test(e2e): the last five stories, and the story list needs no exceptions
792e266 feat(imports): XLSX date cells read as dates, not as their serial number
b5d691f test(e2e): snapshot consistency, forced drift, atomic restore, locks, types
e8b655e feat(engines): postgres names the large-object columns it cannot snapshot
269e0e6 fix(checkouts): a forced restore lets a live-only column take its default
150c294 test(e2e): the deny list, the fixed block list, and restart recovery
0e5de57 test(e2e): boot, key rotation, and backup stories run their own instances
ddbe7d5 feat(boot): copy the metadata database before migrations run
5892123 fix(logger): the daily file is appended, not rewritten from the start
1b3e209 test(e2e): cover the state, job, and checkout stories the screens omit
b9131cd test(e2e): cover the contract and agent stories over the API
0946fba fix(settings): the S3 keys and their set_at land in one transaction
05bffe4 fix(web): toast state moves to lib so no test imports a .tsx
445f926 perf(imports): rejected rows stream to the run file as they arrive
```

## 7. Code patterns to reuse

- Job follow-up in the SPA: `followJob(job, onDone)` in `apps/web/src/lib/sse.ts`; lists that grow:
  `createPaged` in `lib/async.ts` + `components/load-more.tsx`; page envelopes: `apiClient.page`.
- Keyset cursors: `apps/api/src/lib/db/keyset.ts`. Bounded parallelism: `lib/async/lanes.ts`.
- Content-addressed row cache: `apps/api/src/lib/cache/rows-cache.ts`.
- Streaming sinks: `imports.rejected.ts` (lazy open, `close()` before the run is recorded,
  `discard()` on a throw).
- Idempotency: `jobs/jobs.idempotency.ts`. Build the request from what the **client** sent, never
  from the payload, because a payload mints ids and a retry would never match itself. Call `replayWith`
  before the service writes anything, and hand the same request to `enqueue`. A different body
  under a live key still conflicts, which is the point of the key.
- Test harness knobs: `harness.fakeOptions.failCheckout`, `harness.quota.current`.

## 8. In flight and next

**In flight:** nothing. The tree was clean when this was written; `git status` should agree.

**The review and what came out of it (2026-08-30).** Four two-agent teams, reports in
`docs/review/`: 48 findings, 37 confirmed, 5 refuted. Every confirmed blocker and major is fixed,
each with a test that fails when the fix is removed:

| Fixed | Where |
| --- | --- |
| Any interrupted job ended the process (six unswallowed promises) | three engines, `runs.test.ts` |
| The diff invented rows when the key strategy changed | `merge.ts`, `diffs.job.ts` |
| Health never probed the snapshot store | `ops.service.ts` |
| A restore never deferred constraints, or refreshed matviews | `postgres/restore.ts` |
| `origin_shared` was the literal false | `ops.service.ts`, `wiring.store.ts` |
| A bad data dir or migration crashed instead of refusing | `boot.ts` |
| A state reset left the live policy behind | `ops.reset.ts` |
| The engine contract suites ran nowhere | `ci.yml`, `scripts/contract.ts` |
| Nine screens, one voice: progress sentences, dates, crumbs, dialogs, empty states, a row menu | `apps/web` |
| Audit filters, storage paging, a screen for the deny list | `apps/web` |

**Left on purpose:** required fields still use the browser's own validation bubble rather than an
inline error. Replacing it means a validation state per field in every dialog, and the crawler
leans on native validation to fill forms; the gain did not look worth that.

**Watch item, still open.** Solid's "Potential Infinite Loop Detected" has fired three times in
about ten full browser runs, never in a crawl run on its own, and never twice in the same place
until the third: the page was `/projects/demo/adapters/<mongo>/tables/customers`, the data grid.
The crawler now records the page and five frames of the stack with every page error
(`e2e/lib/crawl.ts`), so the next occurrence names the module instead of the symptom. Suspects
read and cleared so far: `fkLink` (pure), the grid's table-change effect (its handler writes
nothing its source reads), and the two SSE effects in `jobs.presenter.ts` and `checkouts.view.tsx`
(the source value does not change when the list refreshes). Do not claim it fixed without a run
that reproduces it first.


**The redesign (2026-08-30).** ADR 0002 records the decision; `docs/design/github.md` is the
specification as it was given. The palette lives in `apps/web/src/styles/app.css` as an override of
Kumo's own variables, after the import, so retargeting them re-skins forty views without touching
one. Dark only: `data-mode="dark"` and `color-scheme: dark`.

Conventions the screens now share, and that a new screen should follow:

| Thing | Where |
| --- | --- |
| Title, one line under it, the action on the right | `components/page-header.tsx` |
| Toolbar over a table, footer under it, empty row inside it | `components/table.tsx` |
| Numbers right, in tabular figures, never wrapping | `<Cell numeric>`; the grid picks by engine type (`NUMERIC_TYPE`) |
| A row's extra actions | `components/menu.tsx`, a `<details>` element |
| A destructive confirm | `components/confirm-dialog.tsx`, never `window.confirm` |
| Timestamps | `lib/format.ts`, never the raw ISO string |
| Page navigation vs a control inside a screen | `Tabs` underline vs `variant="segmented"` |

Content text is 14px. Headings are sentence case. `font-semibold`, never `font-bold`. Mona Sans is
not fetched at runtime, on purpose: the README promises nothing leaves your network.

**The UI target is GitHub.** The user said so on 2026-08-30, reading the UI/UX review. Reach for
GitHub patterns before inventing one: a neutral surface with a single accent, borders rather than
shadows, dense tables that still breathe, one button hierarchy used everywhere, empty states that
name the next action, inline validation, a delete dialog that lists what it destroys, a visible
focus ring, breadcrumbs carrying the real object name. `docs/review/ui-ux.md` and
`docs/review/interface.md` list what breaks this today.

**README:** it opens with what Testate does, one screenshot per capability, then the status, how to
run it, the limits, then operating it. Password recovery is not in it: it lives in the deployment
plan, and the user cut it from the README as out of place. The banner is `docs/assets/hero.svg`,
4:3 and light mode: users outside, Testate and the system under test inside one test server.

**Worth knowing:** `.github/workflows/ci.yml` runs the fast gate (`complete-check`, then a boot and
smoke) on every push. The `contract` job runs the engine suites against the compose engines through
`bun run contract`, which fails when a suite skips: they skip themselves when a target is
unreachable, so for months they ran nowhere and proved nothing. The browser suite and the image build are gated to pull requests, a `v*` tag,
and `workflow_dispatch`, so a push to main does not pay for them. Two things the e2e job needs: a
new compose container has to be named in its `up --wait` list as well as in
`deploy/compose.engines.yml` (`postgres-old` is, for story 20), and one-shot containers must stay
out of that list, because `--wait` fails on a container that exits even with code 0. That is why
`minio-init` runs as its own `compose run --rm` step.

**Password recovery:** an admin resets any account (`POST /users/:id/reset-password`); the last
admin, which nobody can reset and nobody may delete or demote, recovers with
`TESTATE_ADMIN_PASSWORD_RESET=true` at boot (22 §22.2 step 8). That step never creates or promotes
an account: a name that is not an admin refuses the boot with exit 78.

**Releasing:** `bun run bump-version <version>`, commit, tag `v<version>`. The tag runs the browser
suite and the image build in CI; `deploy-image.yml` is still the manual step that slims the image
and pushes it to ghcr.io, and it skips when that version is already published. The image carries
the version in `org.opencontainers.image.version`.

**Remaining ponytails, in order:** the deferrable-constraint check per constraint
(`postgres/write.ts`); backup file naming in the content-addressed store; `readTable` snapshotting
every table. Leave alone: FK `_display` join, S3 `q` in-page filter, MongoDB index exclusion,
`authSource`, the ssh2 note, the in-house router, the diff row cache ceiling.

## 9. Recurring pitfalls (each of these cost at least two chain runs)

| Rule | What trips it | Do this instead |
|---|---|---|
| `max-lines` 300 | any spec or lib that grows a few tests | split early: `lib/boot.ts` (spawn) vs `lib/instance.ts` (requests) |
| `complexity` 10 | parsers, `??` chains | extract a named helper; `??` counts |
| `anti-slop/no-unsafe-dictionary-type` | `Record<string, unknown>`, `{[k: string]: unknown}` | name the payload type at the call site (`call<{ data: … }>`) |
| `anti-slop/no-known-value-widening` | an explicit open-dictionary return type | name the contract (`BootEnv`) or drop the annotation |
| `anti-slop/no-object-parameters` | `body: object` | a named `RequestBody` union |
| `jest/no-conditional-in-test` | `?.`, `??`, ternaries inside `test()` | move it into `e2e/lib` and assert the returned value |
| `no-unused-vars` | leftover imports after a refactor | grep the symbol before committing |

Type system: `exactOptionalPropertyTypes` is on, so never assign `undefined` to an optional key.

**The local gate can lie.** `bun test` runs from the repo root, which has no `tsconfig.json`, so it
transpiles JSX with the React runtime; a stray `~/node_modules/react` on this machine made that
resolve locally and fail in CI. `apps/web/test/graph.test.ts` now fails if any web test reaches a
`.tsx`. When CI disagrees with a green local gate, suspect resolution before logic.

The image build installs with `--ignore-scripts`, so nothing a lifecycle script would produce
exists inside it. The API bundle keeps native addons out with `--external "*.node"`; ssh2 then falls
back to its pure-JS crypto, which `lib/files/sftp.ts` says it must do anyway. Anything the bundle
requires has to be in the tree, not built at install time.

Editing with scripts: `bun run fmt:fix` reflows code, so an anchor written from memory often no
longer matches. Always `grep` the anchor or the new symbol after the edit, and check `git diff`.
Never write `cat > file` without a heredoc: it blocks on stdin and takes the whole shell with it.

Tests encode old behaviour: when a rule changes, expect an existing unit test to fail and update
it, don't weaken the rule.

Before "fixing" the product from an E2E failure, look at the API first. Half of the E2E failures
were a wrong assumption about a label, a schema name, or a response shape, not a bug.

Shell on this Mac: no `timeout`; `grep --include=*.ts` and bare `=====` echo trip zsh globbing
(quote them); `ls` is aliased (use `command ls` in scripts).

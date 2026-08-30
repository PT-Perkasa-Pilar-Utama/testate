# Handover — Testate build session (2026-08-28 → 2026-08-30)

Read this first, then `CLAUDE.md`, then `docs/E2E.md`. Memory notes live in
`~/.claude/projects/-Users-vexeee-Documents-project-testate/memory/` (auto-loaded via `MEMORY.md`).

## 1. What Testate is and where it stands

"Git for your test database". Bun 1.4 monorepo: `apps/api` (Hono), `apps/web` (SolidJS 2 RC),
`packages/shared` (valibot contract). Every PRD card is built and committed on `main`. Nothing is
pushed; the user pushes. There is no open feature work — only ceilings marked `// ponytail:` (12
left; `grep -rn "ponytail:" apps packages e2e scripts`).

E2E: ~120 Playwright tests, ~3 min, coverage **150/150 stories covered**. `NON_UI` in
`e2e/lib/stories.ts` is empty: what no screen shows, an API or boot test covers.

The version is `1.0.0-alpha`. It lives in the root `package.json` — the release workflow tags the
image with it — and `bun run bump-version <version>` writes it into the four `package.json` files
and `apps/api/src/version.ts` at once. `bun run bump-version --check` reports drift, and
`version.test.ts` fails the gate on it.

## 2. Standing rules from the user (do not relitigate)

- Never add `Co-Authored-By: Claude` or "Generated with Claude Code" to commits or PRs.
- Commit finished, gate-green work on your own. Never push (a global hook blocks it anyway).
- Commit subject ≤ 80 characters, and leave a blank line before the body — the heredoc form
  glues them together otherwise and `git log --oneline` shows the whole paragraph.
- No new dependencies for what Bun, the standard library, or an installed package does.
- Roles admin/qa/viewer are cumulative; agent tokens reach `/mcp` only. Secrets are `Sealed`.
- Keep the gate green: `bun run complete-check` then `bun run e2e`. A `pre-push` hook runs
  `complete-check` for you, so nothing reaches CI with a formatting or lint slip.
- Talk like a colleague at a whiteboard: answer first, short sentences, no process narration.

## 3. The working loop that works

One background shell per iteration, never polling loops:

```
bun run complete-check > $S/gate.log 2>&1 || { echo GATE FAIL; exit 1; }
bunx playwright test --reporter=line > .e2e/run.log 2>&1 || { echo E2E FAIL; tail -3 .e2e/run.log; exit 1; }
git add -A && git commit -q -F - <<'EOF' ... EOF
```

Run it with `run_in_background: true` and act on the completion notification. Do **not** write
`until pgrep -f "playwright test"; do sleep; done` — `pgrep -f` matches its own shell and loops
forever.

While iterating on one spec, `bunx playwright test --project=<name> --no-deps` skips the whole
dependency chain: the `boot` project alone runs in ten seconds instead of two minutes.

Two rules while a chain runs: never edit `apps/web` (Vite hot-reloads into the crawl), and
remember `git add -A` at the end sweeps every edit into that commit — park unrelated new files
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

- `api.e2e.ts` / `agent.e2e.ts` — contract and MCP stories over `request` (no browser).
- `state-api.e2e.ts` — state, job, and checkout stories that hold the demo adapters.
- `boot.e2e.ts`, `engine.e2e.ts`, `types.e2e.ts`, `session.e2e.ts`, `storage.e2e.ts` — each
  spawns its own API instance (`e2e/lib/boot.ts`, ports 3101-3113) on its own data dir, and
  drives it through `e2e/lib/instance.ts`. They run **last**: spawning API processes beside the
  browser projects starved the crawl and took a two-minute run to sixteen minutes.
- Spawned instances must stop in `test.afterAll`, not at the end of the test: a failure otherwise
  leaves the port bound, and the next run wipes that instance's data dir under it.
- `e2e/lib/sql.ts` runs SQL on a private Postgres database per test (`scripts/e2e-sql.ts`, Bun,
  because Playwright runs under Node) and on an instance's `metadata.db`
  (`scripts/e2e-sqlite.ts`). Nothing in those specs touches the shared `shop` database.
- Tag every test title with `@story-N`; `coverage.e2e.ts` fails on a tag that names no story.
- Lint applies jest rules to `e2e/`: no conditionals in tests — no `?.`, no `??`, no ternary.
  Put the logic in `e2e/lib` and return a value the test can assert on.
- Crawler (`buttons.e2e.ts`) clicks every visible control; mutators go in `SKIP` in
  `e2e/lib/crawl.ts` and get a story test instead.
- Demo tables live in schema `contract` (not `public`). `getByLabel("X")` also matches option
  text — use `getByRole("combobox", { name })`. Count only your own rows.
- Never wipe data in `playwright.config.ts`; it runs in every worker.

## 5. Contract and product bugs this suite found

The pattern to expect: the contract says one thing, a path does another.

- `GET /settings` answered 500 while another request saved the S3 credentials — the sealed key
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
  from the payload — a payload mints ids, so a retry would never match itself. Call `replayWith`
  before the service writes anything, and hand the same request to `enqueue`. A different body
  under a live key still conflicts, which is the point of the key.
- Test harness knobs: `harness.fakeOptions.failCheckout`, `harness.quota.current`.

## 8. In flight and next

**In flight:** nothing. The tree was clean when this was written; `git status` should agree.

**Worth knowing:** `.github/workflows/ci.yml` runs the fast gate (`complete-check`, then a boot and
smoke) on every push. The browser suite and the image build are gated to pull requests, a `v*` tag,
and `workflow_dispatch`, so a push to main does not pay for them. Two things the e2e job needs: a
new compose container has to be named in its `up --wait` list as well as in
`deploy/compose.engines.yml` (`postgres-old` is, for story 20), and one-shot containers must stay
out of that list — `--wait` fails on a container that exits, even with code 0, which is why
`minio-init` runs as its own `compose run --rm` step.

**Password recovery:** an admin resets any account (`POST /users/:id/reset-password`); the last
admin, which nobody can reset and nobody may delete or demote, recovers with
`TESTATE_ADMIN_PASSWORD_RESET=true` at boot (22 §22.2 step 8). That step never creates or promotes
an account — a name that is not an admin refuses the boot with exit 78.

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

Type system: `exactOptionalPropertyTypes` is on — never assign `undefined` to an optional key.

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
Never write `cat > file` without a heredoc — it blocks on stdin and takes the whole shell with it.

Tests encode old behaviour: when a rule changes, expect an existing unit test to fail and update
it, don't weaken the rule.

Before "fixing" the product from an E2E failure, look at the API first. Half of the E2E failures
were a wrong assumption about a label, a schema name, or a response shape, not a bug.

Shell on this Mac: no `timeout`; `grep --include=*.ts` and bare `=====` echo trip zsh globbing
(quote them); `ls` is aliased (use `command ls` in scripts).

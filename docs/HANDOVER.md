# Handover — Testate build session (2026-08-28 → 2026-08-30)

Read this first, then `CLAUDE.md`, then `docs/E2E.md`. Memory notes live in
`~/.claude/projects/-Users-vexeee-Documents-project-testate/memory/` (auto-loaded via `MEMORY.md`).

## 1. What Testate is and where it stands

"Git for your test database". Bun 1.4 monorepo: `apps/api` (Hono), `apps/web` (SolidJS 2 RC),
`packages/shared` (valibot contract). Every PRD card is built and committed on `main`. Nothing is
pushed; the user pushes. There is no open feature work — only ceilings marked `// ponytail:` (13
left; `grep -rn "ponytail:" apps packages e2e`).

E2E: 77 Playwright tests, ~2 min, coverage **110/150 stories covered, 0 uncovered UI, 0 without a
screen, 40 API-held** (`.e2e/coverage.md` after a run; classification in `e2e/lib/stories.ts`).

## 2. Standing rules from the user (do not relitigate)

- Never add `Co-Authored-By: Claude` or "Generated with Claude Code" to commits or PRs.
- Commit finished, gate-green work on your own. Never push (a global hook blocks it anyway).
- Commit subject ≤ 80 characters — the lefthook `commit-msg` hook rejects longer ones (it bit us
  five times). Conventional Commits; cite the spec section in the body.
- No new dependencies for what Bun, the standard library, or an installed package does.
- Roles admin/qa/viewer are cumulative; agent tokens reach `/mcp` only. Secrets are `Sealed`.
- `// ponytail: <what> — <ceiling>; <upgrade path>` marks deliberate shortcuts. `// SCAFFOLD:` none left.
- Keep the gate green: `bun run complete-check` (type-check, lint, fmt, bun test, build) then
  `bun run e2e`. A change that adds a lint error or a failing test is not done.
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
forever (this produced the "long running shells" the user complained about).

Two rules while a chain runs: never edit `apps/web` (Vite hot-reloads into the crawl), and remember
`git add -A` at the end sweeps every edit into that commit — wait before starting the next card.

On failure read `.e2e/run.log` (`grep -n "^\s*> [0-9]* |"` shows the failing line) and the
snapshot under `.e2e/results/<test>/error-context.md`. Reproduce API bugs directly:

```
PORT=3001 TESTATE_ENV=development TESTATE_DATA_DIR=.e2e/data \
TESTATE_SECRETS_ACTIVE_KEY=$(cat .e2e/key.txt) TESTATE_ADMIN_PASSWORD=admin-password-1234 \
bun apps/api/src/index.ts &   # login admin/admin-final-password-1, PATCH /settings {"netguard":{"deny":[]}}
sqlite3 .e2e/data/metadata.db   # jobs, states, checkouts, import_runs ...
```

`E2E_NET=1` logs every API response to `.e2e/net.log`.

## 4. E2E layout and gotchas (all learned the hard way)

Projects run `coverage → routes → flows (+stories, hooks, gaps, admin) → states → adapter → crawl`.
`states` and `adapter` run alone and serial because checkouts, snapshots, and adapter deletion
restore the shared demo databases; anything editing `customers` in parallel with them flakes.

- Tag every test title with `@story-N`; `coverage.e2e.ts` fails on a tag that names no story.
- Lint applies jest rules to `e2e/`: no conditionals in tests — put logic in `e2e/lib`.
- Crawler (`buttons.e2e.ts`) clicks every visible control; mutators go in `SKIP` in
  `e2e/lib/crawl.ts` and get a story test instead. Dialog titles matching `DESTRUCTIVE` are cancelled.
- Demo tables live in schema `contract` (not `public`). `demoAdapter({engine:"postgres"})` returns
  the first postgres adapter, which may be `pg-<stamp>` from the adapters story (same database).
- `getByLabel("X")` on a `<label><span>X</span><select>` matches the option text too — use
  `getByRole("combobox", { name })` or `exact: true` on text inputs. Dialogs have a ✕ `Close` and
  a footer `Close`: use `getByText("Close", { exact: true })` or `Escape`.
- Toasts stack: wait for `.first()`/`.nth(1)` of a repeated message.
- Count only your own rows (`hasText` on a unique stamp), never `main tbody tr` totals.
- Never wipe data in `playwright.config.ts`; it runs in every worker. Vite proxy targets
  `127.0.0.1` (Node resolves `localhost` to `::1`). Cookies are saved against `localhost`.
- `bun test` roots exclude `.e2e.ts`; web `*.test.ts` files are outside the DOM tsconfig.

## 5. Contract bugs this suite found (pattern to expect on new screens)

`""` where the contract said id (`state.job_id`, live-diff `snapshot_state_id`) → made nullable;
diff export was `text/plain`; dry-run validator ignored `numeric(24,4)`; report hard-coded
`errors_preview: []`; the import job deleted the upload after a dry run; storage-source preview hung
on `Bun.write(path, new Response(stream))` (use a file writer loop — this stalls every time).

## 6. Commits of this session (newest first)

```
d546d59 feat(imports): the date transform applies its timezone through Intl
697cdc6 feat(states): snapshots honour the instance default quota and ceiling
f20dd5b perf(diffs): cache decoded diff rows so pages stop re-reading the blob
6bad029 feat(jobs): snapshot and checkout adapters run in lanes under the job cap
09397e5 feat: keyset cursors on the project, user, token, state, and checkout lists
a970ab7 test(e2e): a new host retargets the adapter and takes a fresh init state
6536dee feat: lock timeouts name their blocking sessions; details offer Terminate
8cf3413 feat(api): preflight names the adapters a partial state leaves untouched
ea04b1b feat(web): edit an adapter — rename, exclusions, schemas, credentials
d206a11 feat(web): editable settings, store migration, and backup on the admin screen
393e384 feat(web): grid links FK cells to the referenced row and lists FKs
e085000 feat(web): import wizard reads a file from a storage adapter
02f540f test(e2e): cover login, delete plan, quota, grid, history, lock, lookup
2b45c20 feat(web): imports tab — upload, preview, map, dry run, run, re-import
a1a049e feat(web): hooks tab — attach requests to triggers, policy, order, remove
3629412 feat(web): diffs tab — compare states or live, drill into rows, export
561e0a7 feat(web): checkouts tab — per-adapter results, retry, counters repair
71c679d feat(web): states tab actions — take, edit, protect, delete, checkout preflight
0b1d291 test(e2e): story-tagged Playwright suite, coverage report, faster crawl
```

## 7. Code patterns to reuse

- Job follow-up in the SPA: `followJob(job, onDone)` in `apps/web/src/lib/sse.ts`; lists that grow:
  `createPaged` in `lib/async.ts` + `components/load-more.tsx`; page envelopes: `apiClient.page`.
- Keyset cursors: `apps/api/src/lib/db/keyset.ts` (`keysetCondition`, `nextCursor`).
- Bounded parallelism by lane: `apps/api/src/lib/async/lanes.ts` (`runLanes`, lane = `target_hash`).
- Content-addressed row cache: `apps/api/src/lib/cache/rows-cache.ts`.
- Test harness knobs: `harness.fakeOptions.failCheckout`, `harness.quota.current` (test/adapters.ts).
- Dialog forms: model → presenter (signals, `attempt`/`showToast`, `static*` captures to satisfy
  `solid/reactivity`) → `*.dialogs.view.tsx`; files ≤ 300 lines, complexity ≤ 10 per function.

## 8. In flight and next

**In flight:** nothing. The tree was clean at `d546d59` when this was written; `git status` should
agree. If it does not, run `bun run complete-check`, read `.e2e/run.log`, fix, rerun, commit.

**Next (designed, not started):** stream rejected import rows per batch instead of one write at the
end (`imports.job.ts` `writeRejected`/`flush`/`process`): a per-run sink that lazily opens
`Bun.file(path).writer()`, writes the header then one CSV line per reject, keeps the first 100 for
`errors_preview`, and `end()`s before `finishRun`; dry runs get a preview-only sink.

Remaining ponytails worth lifting, in order: rejected streaming (above); XLSX date cells via the
styles part; the deferrable-constraint check per constraint (`postgres/write.ts`); backup file naming
in the content-addressed store; `readTable` snapshotting every table. Leave alone: FK `_display`
join (needs a live introspection per page — FK links and lookups cover it), S3 `q` in-page filter,
MongoDB index exclusion, `authSource` field, the ssh2 note, the in-house router.

Open PRD items no dashboard can prove: stories 15, 78, 107 (failure injection; unit-tested).

## 9. Recurring pitfalls (each of these cost at least two chain runs)

Lint rules that fire on almost every new file — write to them up front, do not dodge them:

| Rule | What trips it | Do this instead |
|---|---|---|
| `max-lines` 300 | any view with 3+ dialogs, any harness | split into `*.dialogs.view.tsx` / helper files early; counts code lines only |
| `complexity` 10 | patch builders, validators | extract `xPatch()`, `assertUnder()` helpers |
| `anti-slop/no-conditional-empty-object-spread` | `...(x === undefined ? {} : { x })` | build the object, then `if (x !== undefined) obj.x = x` |
| `anti-slop/no-runtime-typeof` | `typeof v === "string"` | `v.safeParse(v.union([...]), value)` or `Array.isArray` |
| `anti-slop/no-known-value-widening` | `const q: { a: string } = …`, anonymous return types | name the type (`type QuotaKnob = …`) or use `satisfies` |
| `anti-slop/require-safety-comment-for-type-assertion` | `as never`, `as number \| null` | change the signature instead of asserting |
| `solid/reactivity` | reading a signal at setup and using it in a returned async fn | capture as `const staticX = x()` before `attempt(...)` |
| `jest/no-conditional-in-test` | `??`, `?.`, ternaries, `if` inside `test()` and even inside `describe()` | move logic into `e2e/lib` or a module-level helper |
| `no-unused-vars` | leftover imports after a refactor | grep the symbol before committing |

Type system: `exactOptionalPropertyTypes` is on — never assign `undefined` to an optional key.
Test fixtures for `TableSchema` need `unique`, `unsupported`, `excluded`, `display_column` too.

Editing with scripts: `bun run fmt:fix` reflows code, so a python/sed anchor written from memory
often no longer matches. Edits then silently do nothing (the script prints no error when it is
followed by `|| exit`). Always `grep` the anchor or the new symbol after the edit; check `git diff`.

Tests encode old behaviour: when a rule changes (dry run keeps its upload, preflight lists
untouched adapters) expect an existing unit test to fail and update it, don't weaken the rule.

Before "fixing" the product from an E2E failure, look at the API first: `sqlite3 .e2e/data/metadata.db`
and a direct request against a standalone boot (§3). Half of the E2E failures were my wrong
assumption about a label, a schema name, or a toast, not a bug.

Shell on this Mac: no `timeout`; `grep --include=*.ts` and bare `=====` echo trip zsh globbing
(`setopt` is off — quote them); `ls` is aliased (use `command ls` in scripts).

# Interface review — team report

Second pass on top of `docs/review/interface.md` (reviewer 1). Method: `bun run dev` on
ports 3000/5173, data dir `.reviewdata` (deleted after, outside the write boundary),
seeded with the same recipe `e2e/setup.ts` uses (reset-state `dev` seed, three rotated
accounts). Drove Chromium via Playwright from node scripts under
`/private/tmp/.../scratchpad/*.mjs` (not checked in). 24 new screenshots under
`docs/review/shots/r2-*.png`, on top of reviewer 1's `shots/*.png`. No source, test, or
config file was changed — one accidental `Write` to `apps/web/src/components/button.tsx`
during scripting was caught immediately and reverted with `git checkout --`
(`git status` confirms the tree is clean of anything outside `docs/review/`).

**Headline: reviewer 1 missed the only finding in this report that actually matters.**
Taking a snapshot of an adapter that netguard currently blocks does not fail the job —
it kills the whole API process, twice reproduced, for every concurrent user. Everything
below that is real but is polish by comparison.

## 1. New finding: a blocked adapter's snapshot job crashes the entire server

Not a job failure. Not a 500. The Bun process exits. Reproduced twice, from a clean
boot each time, identical stack both times:

```
EngineError: 127.0.0.1:54320 is blocked (policy)
  kind: "unreachable", details: { reason: "policy" }, retriable: false
    at connect (apps/api/src/lib/engines/postgres/pool.ts:40:11)
    at async acquire (apps/api/src/lib/engines/postgres/pool.ts:72:25)
    at async <anonymous> (apps/api/src/lib/engines/postgres/engine.ts:64:30)
Bun v1.4.0-canary.1+6e906e468 (macOS arm64)
```

Repro, both runs identical:

1. `PATCH /settings` with `netguard.deny` containing the adapter's `host:port`
   (`recheckDenyList` auto-disables the adapter — this is itself correct and working).
2. `POST /projects/demo/states` naming that adapter → job `queued`.
3. Within ~2s: `curl .../health/live` refuses the connection; `ps -p <pid>` returns
   nothing. The API is gone. Every other session, every other running job, dies with it.

Root cause, read from source (`apps/api/src/lib/engines/postgres/engine.ts:60-66`):

```ts
snapshot(conn, opts): SnapshotRun {
  const pending = (async (): Promise<SnapshotRun> =>
    snapshot(await pools.acquire(conn), opts))();
  void swallow(pending);                      // only protects `pending` itself
  return {
    manifest: (async () => (await pending).manifest)(),   // <- eager, own promise chain
    async *[Symbol.asyncIterator]() { yield* await pending; },
    ...
  };
}
```

`manifest` starts consuming `pending` immediately and independently of the iterator.
`states.snapshot.ts:120-124` (`snapshotAdapter`) drives the iterator first
(`writeBlobs` → `for await` over `run`), and only reads `run.manifest` afterward. When
`pools.acquire` rejects, the iterator throws first, `snapshotAdapter`'s `try/finally`
propagates that rejection up — but the separate `manifest` promise, already rejected in
the background, is never awaited by anyone on this path. Node/Bun's default
`unhandledRejection` behavior is to terminate the process. `swallow(pending)` at
engine.ts:65 was clearly written to prevent exactly this class of bug, but it only
covers `pending`, not the second independent consumer (`manifest`) built from it. The
same `swallow(pending)` shape repeats at `engine.ts:84` for a second `SnapshotRun`
construction and, from the reader/writer split, mysql's engine likely shares the
pattern — not independently reproduced against mysql/mongo in this pass, so treat that
generalization as plausible, not confirmed.

This is not netguard-specific. Netguard was just the cheapest way to make
`pools.acquire` reject on demand; any adapter connection failure during the snapshot's
first `acquire` (engine restarted, credentials rotated, firewall change, network blip)
takes the same path. In a fleet with `TESTATE_JOB_CONCURRENCY=2` running unattended,
this converts an ordinary "one database was briefly unreachable" moment into a full
outage.

**Confidence: confirmed** (2/2 identical reproductions, full stack trace, root cause
read in source). **Severity: blocker** — this is the data-loss/outage category the task
ranks first, and it sits directly underneath the "Jobs" screen reviewer 1 already
flagged as low-quality.

## 2. Corrected finding: netguard's displayed state and its enforced state silently diverge

Reviewer 1 flagged this as "plausible... outside interface scope" with the wrong causal
story ("doesn't survive a restart"). Reproduced end-to-end, all three legs directly
observed on the same boot:

| Step | Displayed (`GET /settings`) | Enforced (live query) |
|---|---|---|
| Boot | `deny: [127.0.0.0/8, ::1/128]` | blocks loopback |
| `PATCH` deny → `[]` | `deny: []` | allows loopback |
| `POST /admin/reset-state` (no restart) | `deny: [127.0.0.0/8, ::1/128]` (back to default) | **still allows loopback** — `select 1` against the seeded Postgres adapter at 127.0.0.1 succeeds, HTTP 200 |
| Restart the API process, same data dir, nothing re-patched | `deny: [127.0.0.0/8, ::1/128]` | **now blocks** — identical query returns `127.0.0.1:54320 is blocked (policy)` |

Cause, in source: `resetState` (`apps/api/src/modules/ops/ops.reset.ts:29-39`) drops
every metadata table including `settings` and re-migrates — it does not go through
`SettingsService.update()`, so `netguard.setDeny()` (the live in-memory copy,
`apps/api/src/boot.ts:43-53`) is never told. The live copy only resyncs from the
`settings` table at the next process boot (`apps/api/src/index.ts:168`). Between a
reset and a restart, an admin looking at `GET /settings` (or the Settings screen — see
below) sees one policy while the process enforces a different, older one.

Reviewer 1's own repro had the order backwards for a different reason than they
thought: `e2e/setup.ts:41-42` calls `PATCH settings netguard.deny:[]` **before**
`admin/reset-state`, so that patch is wiped by the reset one line later. The suite's
150 stories pass anyway only because the shared `bun apps/api/src/index.ts` webServer
process is never restarted mid-run — the stale-permissive in-memory state survives for
the whole `bun run e2e` session by accident, not by design. Restart that process between
setup and the flow specs (which is exactly what a real deploy does on every release) and
every seeded adapter probe on 127.0.0.1 would start failing with `blocked (policy)`.

Two things make this worse than a backend curiosity:

- **The Settings screen has no netguard section at all.** `r2-16-settings.png` is the
  full page (Snapshot store, Retention, Limits, Quota, Backup) — nothing else exists
  below it, and `grep -rn netguard apps/web/src/features/settings` returns nothing. An
  admin has no UI path to see the deny list, let alone notice it just drifted from what
  is actually enforced. The only way to see or change it is a raw `PATCH /settings`
  call, which is not documented anywhere reachable from the app itself.
- It is audited (`settings.deny_list_changed` shows in `r2-15-audit.png`), so the trail
  exists — but only for someone who already knows to go looking, in a log ordered by
  time, not by "does this match what's enforced right now."

**Confidence: confirmed** (all three legs directly observed, twice for the
before/after-restart pair). **Severity: major** — a security control silently
reverting without telling the operator is exactly "a wrong answer presented as right."

## 3. Design system, as it actually is

- **Palette discipline holds.** `grep -rEn` for raw Tailwind palette classes
  (`bg-red-500` etc.) and arbitrary color values (`[#...]`, `[rgb(...)]`) across
  `apps/web/src/{features,components}` returns zero hits, confirming reviewer 1. Every
  color goes through the `kumo-*` design tokens.
- **Button variants are consistent, one hand-rolled outlier breaks the pattern.**
  `components/button.tsx` defines six variants and four sizes cleanly. The one place
  that needed a link styled as a button (`states.view.tsx:64-67`, "Download") hand-copies
  classes (`h-8 rounded-lg text-sm`) that don't match `Button`'s own `sm` size
  (`h-6.5 rounded-md text-xs`, `button.tsx:25`) and carries none of `Button`'s
  `focus-visible` classes — confirmed by source diff, visible in `r2-05-states-focus-tabbed.png`
  as the one visually mismatched pill in the actions row.
- **Focus ring works — reviewer 1's "invisible" claim is refuted for the only mode the
  app ships.** There is no in-app light/dark toggle (`grep -rn "data-theme\|dark:"
  apps/web/src` is empty); the app follows the OS via CSS `light-dark()`
  (`index.html:6`, `<meta name="color-scheme" content="light dark">`). In that mode,
  tabbing to any `Button`-rendered control produces a real, non-transparent box-shadow —
  `oklch(0.15 0 0) 0 0 0 2px`, the exact light-mode value of `--color-kumo-focus`
  (`theme-kumo.css:164-167`) — and it is visually present, not just in computed style:
  see `r2-08-edit-focused-full.png` / `r2-09-edit-focused-crop.png`, a clearly outlined
  "Edit" button against every unfocused sibling. Reviewer 1's quoted `boxShadow` string
  is a truncated prefix of the real five-layer value (they quote the leading transparent
  layers and stop before the visible fourth one). What does hold up from their finding:
  on `secondary`-variant buttons the focus ring is nearly the same weight as that
  variant's own static `ring ring-kumo-line` border, so focused vs. resting is a subtle
  difference at a glance, and the Download anchor (above) has no ring classes and relies
  on the browser's native outline instead — a real, smaller inconsistency, not the
  app-wide outage reviewer 1 described. Dark mode was not verified: Playwright's
  `colorScheme: 'dark'` context option did not visibly change the app's rendering in
  this pass (`r2-10-edit-focused-dark-crop.png` still renders light), which reads as a
  test-harness gap, not evidence either way — **unknown**, flag for a follow-up with a
  real OS-level dark-mode browser profile.
- **Raw data leaks into user-facing copy in more than one place**, all downstream of
  the same instinct (render the record, not a sentence): Jobs' Progress column
  (`jobs.presenter.ts`, confirmed below), the adapter/table/query/policies/files/requests
  breadcrumb literal `"adapter"` instead of the adapter's name (five files, confirmed
  below), and — new, minor — the Projects list's "Updated" column shows a raw ISO
  timestamp (`r2-01-projects-qa.png`, `2026-08-30T03:46:56.037Z`) rather than a
  formatted or relative date. Not separately ranked below (same root pattern as the
  Jobs finding, lower stakes), but worth fixing together.
- **Dialogs are one component, used two different ways.** The shared `Dialog`
  (`components/dialog.tsx`) is well-built and used for state/adapter/project delete and
  for Take-state — but two admin destructive actions (delete user, revoke token) bypass
  it entirely for `window.confirm()` (confirmed below), so the same instance has both a
  designed confirm pattern and the browser's own.

## 4. User journeys, friction marked

**Sign-in → forced password change → first project.** Clean: login, temp-password
users are routed to a change-password screen, then to `/projects`. No friction found.

**QA reviews a project (`/projects/demo`).** Header, quota card, tabs all load
correctly (`r2-03-project-demo.png`). ⚠ The quota card immediately shows the same
label twice ("Snapshot quota" header, "Snapshot quota" repeated by `Meter`'s own label
row — confirmed in §5). Switching to Checkouts/Diffs/Imports finds a table header row
and then nothing — no "nothing here yet" copy, no explanation of what would appear
(`r2-04-project-tab-checkouts.png`). Hooks at least offers a "New hook" CTA even though
it's equally empty. A first-time user reaches a project with zero context for three of
its six tabs.

**QA takes a state, checks its actions row.** The Take-state dialog is genuinely good —
clear copy, sensible defaults, adapter checkboxes (`r2-11-take-state-dialog.png`). ⚠ The
dialog's backdrop does not visibly dim the page behind it — table rows and the sidebar
are exactly as legible with the dialog open as without (same screenshot; confirmed by
source in §5). The resulting row's six actions render in four different visual styles
in one flex-wrap row that wraps to two lines even on a 1440px viewport
(`r2-05-states-focus-tabbed.png`).

**Admin manages users.** List, New-user dialog, role picker all work
(`r2-19-new-user-dialog.png`). ⚠ Submitting with the required Username field empty
produces the browser's own orange-icon "Please fill out this field." bubble, not the
app's red `Banner` used everywhere else for errors (`r2-20-new-user-empty-validation.png`,
directly captured via `validationMessage`/`validity.valid` on the input — not just a
screenshot guess). ⚠ Clicking Delete on a user fires a bare `window.confirm()`
(`"Delete qa-user? Audit rows keep the name."` — captured via Playwright's `dialog`
event, not just source-reading) instead of the same `Dialog` component used for
state/project delete two clicks earlier in the same session.

**Admin reaches Settings, looks for the netguard control.** Dead end — there isn't
one. The page has Snapshot store, Retention, Limits, Quota, Backup and stops
(`r2-16-settings.png`, full page). No indication that a `netguard.deny` setting even
exists, let alone that it can drift from what's enforced (§2).

**Viewer hits an admin-only route.** `/audit` and `/users` both refuse cleanly with
"Your role cannot open this page." (`r2-17-viewer-audit-refused.png`) — no dead end, no
raw 403 JSON, nav correctly omits the links. This is the one journey in the whole pass
with zero friction to report; worth calling out since everything else on this list is a
problem.

**Admin opens the Jobs screen to check on the two jobs that just ran.** Every row's
Progress column reads like a debugger dump: `"phase snapshot · adapter_id
01a050c7-06f4-74d5-ad69-df3001192701 · adapters_done 3 · tables_done 3 · table
orders"` (`r2-06-jobs.png`, full text captured via `innerText`) — no adapter name, no
percentage, no bar, despite `Meter` (a working progress-bar component) being one screen
away on every project page. And, unreproduced from this screen alone but proven in §1:
if the job in that row happened to be snapshotting an adapter that's currently
unreachable, this screen is not where you'd find out — the whole app would already be
down.

## 5. Defect list, ranked

Screenshot paths are relative to `docs/review/`. Confidence "confirmed" means observed
directly in this pass (source read, reproduced in the running app, or both);
"refuted" means reviewer 1's specific claim did not hold up under direct
reproduction.

1. **[blocker] Snapshotting an unreachable/blocked adapter crashes the whole API
   process.** New in this pass. `apps/api/src/lib/engines/postgres/engine.ts:60-66`.
   Evidence: two identical full-process crashes with stack trace (§1); process
   unreachable and `ps -p` empty both times. — confirmed
2. **[major] Netguard's displayed policy silently diverges from what's enforced,
   with no UI to see or fix it.** Corrects reviewer 1's "plausible, out of scope" note.
   `apps/api/src/modules/ops/ops.reset.ts:29-39`, `apps/api/src/boot.ts:43-53`,
   `apps/web/src/features/settings/` (absent). Evidence: full before/after-restart
   table, all legs directly observed (§2); `shots/r2-16-settings.png`. — confirmed
3. **[major] Jobs' Progress column renders raw JSON keys and a UUID instead of a
   sentence.** `apps/web/src/features/jobs/jobs.presenter.ts`. Evidence:
   `shots/r2-06-jobs.png`, full row text captured. — confirmed (matches reviewer 1)
4. **[major] AccountView (password/session self-service) is fully built and
   unreachable.** `apps/web/src/features/account/account.view.tsx`,
   `apps/web/src/routes.ts` (no `account` entry), `app.tsx` (no reference at all).
   Evidence: `shots/r2-02-account-route.png` reads "No page at /account."; grep
   confirms zero references outside the feature's own file. — confirmed (matches
   reviewer 1)
5. **[major] Breadcrumb back-link is the literal word "adapter" on five screens, never
   the adapter's actual name.** `apps/web/src/features/data/grid.view.tsx:217`,
   `query.view.tsx:161`, `policies.view.tsx:155`, `apps/web/src/features/storage/storage.view.tsx:167`,
   `apps/web/src/features/rest/rest.view.tsx:170`. Evidence: all five read directly,
   identical `<a>adapter</a> / ...` pattern. — confirmed (matches reviewer 1, line
   numbers verified/corrected against source)
6. **[major] Delete-user and revoke-token use `window.confirm()`, not the app's own
   Dialog.** `apps/web/src/features/users/users.presenter.ts:109`,
   `apps/web/src/features/tokens/tokens.presenter.ts:81`. Evidence: Playwright's
   native `dialog` event fired with the exact message on Delete click;
   `shots/r2-12-users.png`. — confirmed (matches reviewer 1)
7. **[minor] Dialog backdrop never visibly dims the page.**
   `apps/web/src/components/dialog.tsx:40`, `backdrop:bg-kumo-overlay/60` where
   `--color-kumo-overlay` is `oklch(97.5% 0 0)` in light mode — near-white at 60%
   opacity over a white page. Evidence: `shots/r2-11-take-state-dialog.png` and
   `shots/r2-19-new-user-dialog.png`, background table rows equally legible with the
   dialog open. — confirmed (matches reviewer 1)
8. **[minor] Six screens render an empty table with no empty-state message or
   guidance.** `apps/web/src/components/table.tsx` has no zero-row handling.
   Confirmed directly: Checkouts (`shots/r2-04-project-tab-checkouts.png`), Diffs
   (`shots/r2-04-project-tab-diffs.png`), Imports
   (`shots/r2-04-project-tab-imports.png`), Hooks — has a CTA but still no message
   (`shots/r2-04-project-tab-hooks.png`), Tokens (`shots/r2-14-tokens.png`). Not
   independently reproduced this pass: reviewer 1's sixth screen (project Hooks tab —
   here confirmed empty but with a CTA, a small correction to their "no create CTA
   visible either" note, which was accurate for Checkouts but not Hooks). — confirmed
   (with one correction)
9. **[minor] States row actions: six controls in four visual styles, one hand-rolled
   anchor with its own sizing and no focus ring.** `apps/web/src/features/states/states.view.tsx:64-67`.
   Evidence: source diff against `button.tsx`'s `sm` size class
   (`h-6.5/rounded-md/text-xs` vs. the anchor's `h-8/rounded-lg/text-sm`);
   `shots/r2-05-states-focus-tabbed.png` shows the visual mismatch and the anchor as
   the only element with a native (not app) focus outline. — confirmed (matches
   reviewer 1)
10. **[minor] Storage browser renders 200+ rows with no pagination or virtualization;
    sidebar isn't sticky.** `apps/web/src/features/storage/storage.presenter.ts:39`
    (`PAGE_SIZE = 200`). Evidence: `shots/r2-07-adapter-overview.png`, a 1440×2267px
    page for one directory (this run's seeded exports bucket had ~90 leftover
    `store-*/` entries). Correction to reviewer 1's numbers: their run measured
    1440×2305 with Sign-out "rendering nowhere near the viewport"; this run's page is
    2267px tall and Sign-out is reachable near the bottom of the same full-page
    screenshot, not clipped off — same underlying defect (no pagination, non-sticky
    sidebar), milder in degree, exact severity depends on how much leftover data a
    given instance has accumulated. — confirmed (numbers corrected)
11. **[minor] Audit log has no pagination, filter, or search UI.**
    `apps/web/src/features/audit/`. Evidence: `shots/r2-15-audit.png`, long table, zero
    controls above it. Not independently re-read at the source level this pass (relied
    on reviewer 1's `audit.model.ts` citation plus this pass's screenshot). —
    confirmed, source citation not re-verified
12. **[nit] "Snapshot quota" label rendered twice on every project screen.**
    `apps/web/src/features/project/project.view.tsx:52` (outer `<span>`) plus
    `apps/web/src/components/meter.tsx:26` (`Meter`'s own label row, passed the same
    string). Evidence: both call sites read; visible directly in
    `shots/r2-08-edit-focused-full.png`. — confirmed (matches reviewer 1)
13. **[nit] Required-field validation uses the browser's native tooltip, not the
    app's Banner.** Evidence: `dialog[open] input[required]` on an empty submit
    reports `validationMessage: "Please fill out this field."`,
    `validity.valid: false` — captured programmatically, not just visually;
    `shots/r2-20-new-user-empty-validation.png`. — confirmed (matches reviewer 1)
14. **[refuted] "Keyboard focus is invisible on every Button-component control
    app-wide."** Reviewer 1's major finding #1. In the app's only shipped mode (no
    in-app theme toggle; OS `light-dark()`), tabbing to a `Button` produces a real
    `oklch(0.15 0 0) 0 0 0 2px` box-shadow — the correct, non-transparent
    `--color-kumo-focus` light value — and it is visibly rendered:
    `shots/r2-08-edit-focused-full.png`, `shots/r2-09-edit-focused-crop.png`. Their
    quoted computed-style string is a truncated prefix that stops before the visible
    fourth shadow layer. The real, narrower issue survives: on `secondary`-variant
    buttons the focus ring is low-contrast against that variant's own static border,
    and the Download anchor has no ring classes at all (folded into #9 above). — refuted
    as stated; a milder version is real

## 6. What's still unknown

- **Dark mode.** No in-app toggle exists; the app follows the OS via `light-dark()`.
  Playwright's `colorScheme: 'dark'` context emulation did not visibly flip the
  rendering in this environment, so the focus-ring color, the dialog backdrop, and
  every other light-mode-verified finding above are unverified in dark mode. Needs a
  real OS/browser dark-mode profile, not just a Playwright flag, to check for real.
- **Session expiry / idle timeout.** `limits.write_session_idle_minutes` exists as a
  setting (`shots/r2-16-settings.png`) but its UI behavior (does the SPA warn before
  expiry, does it dead-end on the next click, does it redirect to `/login` cleanly)
  was not tested — would need either clock manipulation or a 30+ minute wait, out of
  budget for this pass.
- **Long names / huge grids.** Not tested: a project or adapter name long enough to
  overflow its header, or a table with enough columns to force horizontal scroll
  inside the grid view. `apps/web/src/features/data/grid.view.tsx` wraps its table in
  `overflow-x-auto` per source, which is the right pattern, but not visually verified
  against a wide seed table.
- **What a `failed` job actually looks like in the Jobs screen.** Never observed: the
  one failure mode this pass triggered (an unreachable adapter mid-snapshot) crashes
  the process before a `failed` row can render at all, which is itself the headline
  finding (§1) rather than a gap in this testing.
- **A genuinely empty project** (zero adapters, zero states) — the seeded demo project
  always has both. Not tested whether the Adapters tab's own empty state (if any)
  differs from the four confirmed-empty ones above.
- **mysql/mongo engines' snapshot code paths for the same crash shape as #1.** The
  `swallow(pending)` / eager `manifest` pattern repeats at
  `apps/api/src/lib/engines/postgres/engine.ts:84` for a second `SnapshotRun`
  construction, and the reader/writer split suggests mysql shares the shape — not
  independently reproduced against mysql or mongo this pass. Given #1 is
  deterministic and cheap to trigger, this should be checked before calling the
  crash "postgres-only."

## 7. Fix first, in this order

1. **The process crash (#1).** Nothing else on this list matters if the server can be
   taken down by an ordinary "take a state" click against a database that happens to be
   unreachable at that moment. Fix: make `SnapshotRun.manifest` lazily derive from
   whatever the iterator already consumed (or attach a `.catch(() => {})` to the eager
   promise the same way `swallow(pending)` already protects `pending` itself), then add
   the one-line regression test the engineering doctrine asks for: assert that a
   rejected `pools.acquire` during `engine.snapshot()` produces a rejected
   `snapshotAdapter()` call and *not* a process-level `unhandledRejection`.
2. **The netguard divergence (#2).** Either make `resetState` call through
   `SettingsService` (or otherwise re-sync `netguard.setDeny()`) instead of a raw table
   drop, or — cheaper — have `index.ts` boot's `netguard.setDeny()` call also fire
   immediately after any settings-table-bypassing reset, and surface the current deny
   list somewhere in the Settings screen so "what's displayed" and "what's true" are at
   least both visible to the person responsible for them.
3. **Jobs' Progress column (#3) and the "adapter" breadcrumb (#5).** Both are the same
   underlying habit — render the record, not a sentence — and both sit on screens every
   role uses constantly. Fixing the formatter in one place (a `describeProgress` that
   resolves the adapter name and a percentage) and passing the adapter object already
   loaded on all five breadcrumb screens into the header label closes two "wrong-looking
   status" findings for less effort than any one of the empty-state or dialog fixes
   further down the list.

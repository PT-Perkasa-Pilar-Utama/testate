# Testate review — interface

Scope: the SPA only (`apps/web`), driven with real Chromium via Playwright against a live
`bun run dev` instance (API :3000, Vite :5173, fresh data dir, seeded with the same `dev` seed
`e2e/setup.ts` uses — admin/qa-user/viewer-user, one demo project, six adapters across
postgres/mysql/mariadb/mongo/s3/http). Every finding below is something I clicked, screenshotted,
or measured myself this session; screenshots are under `docs/review/shots/` (50 PNGs, referenced
by filename below). Ports 3000/5173 freed at the end; the shared compose engines were never
touched, only read from.

## Verdict

The person paying for this thinks the interface is bad. They're right, but not for the reason
they probably think. The visual design is disciplined — I grepped the whole `features/` tree for
raw Tailwind palette classes and arbitrary hex colours and found none; everything routes through
the `kumo-*` design tokens, and the two flows that matter most for trust (the checkout preflight,
the state-delete confirmation) are genuinely well built: clear titles, real consequences spelled
out, a proper reversibility notice. This isn't a slapped-together UI.

What's actually wrong is underneath the polish: **every button in the app loses keyboard focus
visibility** (confirmed by computed style, not eyeballing), **a fully-built self-service password
screen is wired to nothing** (dead route), **every list in the app that can be empty renders
nothing when it is**, and **the one screen that shows snapshot/restore progress — the actual job
of the product — prints raw JSON keys and UUIDs instead of a sentence**. None of these are
one-off slips; each reproduces on 3–5 separate screens. That's a pattern: the shared components are
solid, but several screens either bypass them or feed them literal internal state instead of copy.

## Ranking rule

Ordered by what would actually stall or mislead someone using this daily. A dead flow with no
error message outranks a wrong-looking button, because the user doesn't even know something's
missing. A cross-cutting defect (same bug on 5 screens) outranks a single-screen one of similar
severity.

## Confirmed findings, ranked

### 1. Keyboard focus is invisible on every button in the app

**Severity: major — the whole app is unusable by Tab alone.** Tabbed 20 times through
`/projects/demo` States tab and read `getComputedStyle(document.activeElement)` after each press.
Every `<button>` rendered by the shared `Button` component (`apps/web/src/components/button.tsx`)
reports `box-shadow: rgba(0,0,0,0) 0px 0px 0px 0px, rgba(0,0,0,0) 0px 0px 0` while focused —
fully transparent, not just low-contrast — even though `element.matches(":focus-visible")` is
`true` and the class list does contain `focus-visible:ring-2 focus-visible:ring-kumo-focus`
(`button.tsx:6`). The one control in the same row that isn't a `Button` — the hand-rolled
`Download` anchor at `apps/web/src/features/states/states.view.tsx:65-70` — is the *only* element
in the whole tab sequence that shows a visible ring, and only because it still carries the
browser's native `outline: auto 1px rgb(0, 95, 204)` that `Button`'s `outline-none` base class
(`button.tsx:6`) strips everywhere else.

Screenshot `80-states-focus-order.png`: eight tab presses land on `Take state`, and nothing in the
frame indicates it. Repro: any screen, `Tab` a few times, watch nothing highlight.

**Effect:** a keyboard user (or a low-vision user driving via keyboard) cannot tell what will
activate on Enter, anywhere buttons are used — which is nearly the entire app, tab bars included.
The boundary of the bug is precise, not total: `components/input.tsx`-based text fields do get a
visible focus ring (compare Username vs. focused Password in `06-login-focus-tab2.png`), so this
is specifically the `Button` component's focus treatment, not every focusable element.

### 2. Job progress is a raw key/value dump of internal state, not a status a user can read

**Severity: major — this is the status screen for two of the product's three core jobs.**
`apps/web/src/features/jobs/jobs.presenter.ts:28-36`, `describeProgress`, joins every key in the
job's raw `progress` JSON with `" · "` and renders it verbatim
(`jobs.view.tsx:43,93`). Screenshot `30-jobs.png`, row 1:

> `phase snapshot · adapter_id 01a050b0-132c-707d-bc04-22746f0d98e6 · adapters_done 3 · tables_done 3 · table orders`

No adapter name (only the UUID a human can't match to `shop-postgres` without a second lookup),
no percentage, no progress bar — despite the app having a working `Meter` component
(`components/meter.tsx`) used one screen away for snapshot quota. `When`/`Created`/`Taken`/`Started`
columns across Jobs, Audit, States and Checkouts all print raw ISO-8601 timestamps
(`2026-08-30T03:21:51.848Z`) rather than a formatted date, and Settings prints its keys as literal
dotted identifiers (`retention.stash_keep`, `limits.query_rows_default`, `44-settings.png`) instead
of a label. Same root cause each time: internal field names reach the screen unformatted.

### 3. AccountView — self-service password change and session list — is fully built and completely unreachable

**Severity: major — a real, finished screen with zero way in.** `apps/web/src/features/account/`
has a complete `account.view.tsx` (password-change form, session table with per-session revoke).
It is imported nowhere: `grep -rn "AccountView" apps/web/src` finds only its own `export default`.
`apps/web/src/routes.ts` has no `account` entry in `ROUTE_NAMES` or `ROUTES`. Navigating to
`/account` renders "No page at /account." (`02-account-route-missing.png`).

Consequence, confirmed by reading `apps/web/src/app.tsx:183-195`: `ChangePasswordView` only
mounts when `session().must_change_password === true`, which is only true immediately after
account creation or an admin-triggered reset. Once that first change is done, **there is no way
in the UI, ever again, for a user to change their own password or see/revoke their own active
sessions.** The sidebar (`app.tsx:146-158`) shows only the actor's label/role and a Sign-out
button, nothing else. Admin has an indirect workaround — `/users` → "Reset password" on their own
row (`41-users.png`) issues a new temporary password that forces a change on next login, which is
a clunky two-step, admin-only, log-yourself-out path, not a substitute for the built screen. qa
and viewer roles have no path at all, direct or indirect: only an admin can rotate their
credential or kill a session for them, and the session-revoke feature has no admin-side
equivalent — nobody, including admin, can see or kill any user's active sessions from the UI.

### 4. No breadcrumb anywhere; the one "back" link is hardcoded to the literal word "adapter" on five separate screens

**Severity: major — wayfinding is broken below the project level.** `grep -rni "breadcrumb"
apps/web/src` returns nothing; there is no breadcrumb component in the app at all. From an
adapter's overview (`20-adapter-postgres-overview.png`) there is no link back to the Demo project
— only the flat sidebar (Projects/Jobs/Tools), which goes to the *list*, not back to where you
were. One level deeper, every adapter sub-screen does render a small back-link, but it's the
literal string `"adapter"`, not the adapter's name, in every one of:

- `apps/web/src/features/data/grid.view.tsx:217`
- `apps/web/src/features/data/query.view.tsx:160`
- `apps/web/src/features/data/policies.view.tsx:156`
- `apps/web/src/features/storage/storage.view.tsx:168`
- `apps/web/src/features/rest/rest.view.tsx:170`

Screenshots `22-adapter-query-result.png`, `24-adapter-table-grid.png`, `26-adapter-requests-http.png`
all show the header reading `adapter / <thing>` verbatim. The link itself works (it navigates to
the adapter overview), so this isn't a dead link — but with six adapters in one seeded demo project
(and presumably more in a real one), a user with two tabs open to two different adapters' query
consoles cannot tell which is which from the page chrome, only from the URL.

### 5. Deleting a user or revoking a token uses the browser's native `confirm()`, not the app's own dialog

**Severity: major — inconsistent, unstyled, and silently unautomatable.** Every other destructive
action in the app (delete state, delete adapter, delete project) opens the shared `Dialog`
component (`components/dialog.tsx`) with a title naming the target, an explanation, and a red
confirm button — see `62-dialog-delete-state-confirm.png` for a good example. Two screens don't:

- `apps/web/src/features/users/users.presenter.ts:109` —
  `window.confirm(\`Delete ${user.username}? Audit rows keep the name.\`)`
- `apps/web/src/features/tokens/tokens.presenter.ts:81` —
  `window.confirm(\`Revoke ${token.name}? Requests with it fail from now on.\`)`

Confirmed by clicking "Delete" on a user row in a real browser: no custom dialog appears
(`63-dialog-delete-user-confirm.png` shows the bare table, unchanged, because Playwright — like
many automation and remote-control contexts — auto-dismisses unhandled native dialogs). These are
the two most security-sensitive destructive actions in the admin surface (removing an account,
killing a credential), and they're the only two that break from the app's own confirmation
pattern, look like an OS chrome popup instead of the product, and can't be restyled for dark mode
or matched to the rest of the copy voice.

### 6. Dialog backdrop never visibly dims the page behind it

**Severity: normal, but affects every dialog in the app.** `components/dialog.tsx:32` sets
`backdrop:bg-kumo-overlay/60` on the native `<dialog>`, but `--color-kumo-overlay` in light mode
(`apps/web/node_modules/@cloudflare/kumo/dist/styles/theme-kumo.css:119-122`) is
`light-dark(oklch(97.5% 0 0), oklch(26.9% 0 0))` — i.e. near-white in light mode. A near-white
layer at 60% opacity over an already-white page is not visible. Confirmed across four separate
dialog screenshots (`60`, `62`, `63`, `64`, `90`): in every one, the table/page behind the modal
is exactly as legible as with no dialog open at all — no scrim, no depth cue that something is
now modal. This reads as the app reaching for a Kumo *surface* token (meant for elevated panels,
which are legitimately near-white-on-white) to do a *scrim*'s job, where a fixed dark
tint independent of theme is what a backdrop needs.

### 7. No empty state anywhere in the app

**Severity: normal, but this is systemic, not a one-off.** `grep -rn "No .* yet\|EmptyState\|nothing here\|No results" apps/web/src/features apps/web/src/components`
returns zero matches, and the shared `Table` component (`components/table.tsx`) has no built-in
handling for a zero-row body. Confirmed on four different tabs of the seeded demo project — which
has adapters and one state, but nothing else yet — plus the instance-wide Tokens screen:

- `12-project-diffs-tab.png` — header row, then blank white to the floor
- `12-project-checkouts-tab.png` — same, and no "New checkout" CTA at all (the create action only
  exists as "Check out" on a state row, so a first-time user landing on an empty Checkouts tab has
  no way to tell how to get one)
- `12-project-imports-tab.png` — same
- `26-adapter-requests-http.png` — same
- `100-project-hooks-tab.png` — same
- `42-tokens.png` — same

That's four of the demo project's six tabs (only Adapters and States have seed data), plus the
Requests sub-screen of the REST adapter and the instance-wide Tokens screen — six separate places
where a first-time user's first look is an unlabelled blank rectangle, indistinguishable from a
stuck loading state or a fetch that silently failed.

### 8. States row: six actions, four visual styles, one of them a hand-styled anchor that drifts from the Button component

**Severity: normal.** `RowActions` in `apps/web/src/features/states/states.view.tsx:51-99` packs
Details (ghost button), Download (raw `<a>`), Check out (primary/black), Edit (secondary),
Protect/Unprotect (secondary), Delete (destructive/red) into one `flex flex-wrap` row —
screenshot `12-project-states-tab.png` shows every row wrapping to two lines because six controls
don't fit 1440px width next to a Size/By/Taken column set. The `Download` link
(`states.view.tsx:66`: `class="inline-flex h-8 items-center rounded-lg px-3 text-sm hover:bg-kumo-tint"`)
hand-copies `Button`'s look instead of rendering `<Button as="a">`, and drifts from it: `h-8` vs.
the sibling `sm` buttons' `h-6.5` (`components/button.tsx:24`), `rounded-lg` vs. `rounded-md`,
`text-sm` vs. `text-xs` — visibly a different height and corner radius in the same row
(compare "Download" to "Check out" in `12-project-states-tab.png`).

Also: with five black "primary" buttons on screen at once (one `Take state` plus one `Check out`
per row), "primary" stops meaning anything — there's no single visual answer to "what's the main
action on this screen."

### 9. Storage browser: 200 unpaginated rows in one page, and the sidebar's own sign-out drifts thousands of pixels down as a result

**Severity: normal — this is the "too many rows" case the review was asked to check, and it fails.**
The seeded `exports` (s3) adapter's bucket root has roughly 90+ leftover `store-*/` snapshot
directories. `apps/web/src/features/storage/storage.presenter.ts:39` sets `PAGE_SIZE = 200` and
renders that whole page as one DOM list with no virtualization; `25-adapter-files-s3.png` is
**1440×2305px** for a single directory listing, more than 2.5 screens tall, with the "filter by
name" box present but not applied by default.

Because `apps/web/src/app.tsx:128` lays the sidebar out as `<aside class="flex w-56 flex-col ...">`
— a flex sibling of `<main>` with no `sticky`/`fixed` positioning — and the account/sign-out block
uses `mt-auto` (`app.tsx:146`) to sit at the bottom of that (stretched-to-match) column, a long
page drags primary navigation and the sign-out control down with it. Cropped from the same
screenshot (`y≈1900-2305`): "qa-user · qa" and "Sign out" render nowhere near the viewport, only
reachable by scrolling through the entire file listing first.

### 10. Audit log has no pagination, filter, search, or export

**Severity: minor, but a real gap for a compliance-facing screen.** `apps/web/src/features/audit/audit.model.ts`
calls `GET /audit-logs` with no cursor or limit parameter; `audit.presenter.ts` never re-fetches
with an offset; `audit.view.tsx` (58 lines total) has no filter/search input, no date range, no
export button, no `load-more.tsx` usage despite that shared component existing in
`components/load-more.tsx` for exactly this. Whatever the server's default cap on `/audit-logs`
is, that's the entire audit trail a user will ever be able to see through the UI — there's no way
to page further back, filter by actor/action, or pull a range for a compliance request.

### 11. Duplicated "Snapshot quota" label on every project screen

**Severity: nit.** `apps/web/src/features/project/project.view.tsx:52` renders
`<span>Snapshot quota</span>` as the card's own header, then line 55 passes
`label="Snapshot quota"` to `<Meter>` again, which (`components/meter.tsx:26`) renders its own
visible label row. Every project screenshot (`11`, `12-*`) reads literally "Snapshot quota" twice,
stacked, with an empty `detail` slot on the second line where the percentage could have gone
instead of being duplicated in the row above.

### 12. Required-field validation falls back to the browser's native tooltip, not the app's own error style

**Severity: minor, but visible on every form in the app.** Submitting "Take state" or "New user"
with a required field empty doesn't produce the app's own red `Banner` component (the one used
for login errors, `04-login-bad-credentials.png`, and for the query console's SQL errors,
`103-query-error-state.png`) — it produces the browser's native HTML5 `required` tooltip: a
yellow warning icon, OS-default font, "Please fill out this field." Confirmed on two different
dialogs — `102-dialog-take-state-empty-validation.png` and
`105-dialog-new-user-empty-validation.png` — both render the identical native Chrome bubble,
visually foreign to every other piece of chrome in the app and unstyleable (no dark-mode variant,
doesn't match copy voice). Same family of issue as finding #5: native browser affordances leaking
through in specific forms while the rest of the app carefully avoids them.

## What I checked and found fine

- Role gating: viewer hitting `/users` gets a clear, correctly-styled "Your role cannot open this
  page" banner (`50-viewer-users-forbidden.png`); qa role correctly loses Edit/Protect/Delete on
  the States tab.
- `/health` unauthenticated leaks nothing beyond `ok` (`01-health-loggedout.png`) — no version,
  no engine detail, no stack trace.
- **Error states, once past finding #12's validation gap, are genuinely good.** A bad SQL query
  surfaces the real driver error inline in red (`query: relation "does_not_exist_table" does not
  exist`, `103-query-error-state.png`) — the right call for a console aimed at people who read
  SQL errors for a living. Testing a new adapter's connection against a dead port
  (`127.0.0.1:1`) returns a clear `probe: Failed to connect` banner inside the same dialog
  (`107-adapter-test-connection-error.png`) rather than a silent failure or a raw stack trace.
- Mongo's query console isn't the Postgres SQL box reused — it's a purpose-built form (operation
  picker, collection, Filter/Projection/Sort as separate JSON fields, `104-mongo-query-console.png`)
  that matches how Mongo queries actually work instead of forcing a document store through a
  SQL-shaped textbox.
- The Hooks "New hook" dialog keeps its submit button disabled until the required REST-adapter and
  saved-request selects are filled (`101-dialog-new-hook.png`) — correct disabled-until-valid
  behaviour, not caught by finding #12 because it never needs the native tooltip at all.
- Design tokens: zero raw Tailwind palette classes or hex colours anywhere in `features/` or
  `components/` — everything routes through `kumo-*`. The system itself is consistent; findings
  #5, #6, #8 are places specific screens broke from it, not evidence the system is undisciplined.
- Text contrast: measured `text-kumo-subtle` (the app's secondary-text colour, used for every
  table header and helper line) against its actual rendered background via canvas-resolved RGB —
  4.74:1, clears WCAG AA's 4.5:1 for normal text.
- Checkout preflight (`90-checkout-preflight-dialog.png`) and state-delete confirm
  (`62-dialog-delete-state-confirm.png`) are the best screens in the app: named consequences,
  reversibility called out, per-adapter restore strategy spelled out in plain language. This is
  what the rest of the destructive-action surface should look like.
- Responsive: 1280px and 1440px (`70-responsive-1280-project.png`, `71-responsive-1280-query.png`)
  showed no overflow, clipping, or broken wrapping — just unused right-hand whitespace at both
  widths, consistent with every screen in the app leaving 40–60% of viewport width empty.

## The design system that exists today

`apps/web/src/components/` holds 15 files, all wired through Kumo's `kumo-*` CSS custom
properties rather than raw Tailwind palette classes (confirmed by grep — zero hits for
`text-red-\d+`, `bg-blue-\d+`, arbitrary hex, or arbitrary `text-[...]`/`bg-[...]` values anywhere
under `features/` or `components/`, one exception noted below). Usage counts are file-level greps
for the import, so a component used many times in one big file only counts once:

| Component | Used in | Note |
| --- | --- | --- |
| `button.tsx` | 36 feature files | The one with the broken focus ring (finding #1). |
| `table.tsx` | 26 | No empty-row handling built in — every screen that's empty has to opt in, and none do (finding #7). |
| `badge.tsx` | 26 | Status pills (ok/ready/protected/etc.); consistent. |
| `banner.tsx` | 22 | The app's real error/info/warning surface — bypassed by findings #5 and #12. |
| `input.tsx` | 21 | Gets a visible focus ring, unlike `button.tsx` (see finding #1). |
| `dialog.tsx` | 20 | Backdrop scrim is a no-op in light mode (finding #6); everything else about it is solid and used consistently — bypassed only by `window.confirm()` in the two spots in finding #5. |
| `select.tsx` | 15 | — |
| `layer-card.tsx` | 8 | The page-level "card" surface (project header, settings sections). |
| `switch.tsx` | 6 | — |
| `load-more.tsx` | 5 | Cursor-pagination control — exists, but unused by Storage (which renders all 200 rows flat, finding #9) or Audit (which has no pagination at all, finding #10). |
| `input-area.tsx` | 4 | Multi-line text (notes, SQL). |
| `tabs.tsx` | 4 | Project tabs, states List/Tree toggle, query console Saved/History/Running. |
| `meter.tsx` | 1 | Only the project quota bar — and even that one call site double-renders its own label (finding #11). |
| `toast.tsx` | 0 direct imports, but active | Not imported by feature views directly — every feature calls `showToast()`/`reportError()`/`attempt()` from `lib/toast.ts` (20 call sites), which is the intended indirection; `<Toaster/>` itself mounts once in `app.tsx`. Working as designed. |
| `kbd.tsx` | 0 | Genuinely unused — no feature file and no other component imports it. Small-scale version of finding #3: a built piece of UI nothing ever mounts. |

The one deviation from token-only styling is `components/toast.tsx:17`'s
`max-w-[320px]` arbitrary value — cosmetic, not a token violation in spirit (there's no
`kumo-*` size token for a toast's max width to begin with).

**Overall:** the shared layer is disciplined and most features use it correctly. Where the report
above calls out an inconsistency, it's specific screens opting out of a working shared component
(`states.view.tsx`'s hand-rolled Download link past `button.tsx`, `users`/`tokens` reaching for
`window.confirm()` past `dialog.tsx`) or a shared component's own bug reaching every caller at
once (`button.tsx`'s focus ring, `dialog.tsx`'s backdrop token) — not a codebase that never
converged on a system in the first place.

## Journey map: the three jobs the product exists to do

| Job | Path | Clicks | Stall point |
| --- | --- | --- | --- |
| Take a snapshot | Projects → Demo → States tab → **Take state** → fill Name → **Take** | 4 clicks + 1 required field | None functional. First-timer's likely confusion: quota meter reads "Snapshot quota / Snapshot quota" (finding #11) before they've taken anything. |
| Restore it | Projects → Demo → States tab → **Check out** on a row → review preflight → **Check out** | 3 clicks | None functional — the preflight dialog (finding "what's fine", above) is genuinely good. The stall is upstream: a first-timer landing on the empty Checkouts tab (finding #7) has no visible way to *start* a checkout from that tab; they have to already know to go find a state row instead. |
| See what changed | Projects → Demo → Diffs tab → **New diff** → pick Base + Target → **Compare** → wait for the job → **Details** | 5 clicks + 2 selects | Same upstream stall as restore: the empty Diffs tab (`12-project-diffs-tab.png`) gives no hint that "New diff" (top-right, easy to miss against the wall of white) is the only way in. Once started, the job's status is the raw dump from finding #2, so a first-timer watching a diff run sees `phase diff · adapter_id 01a050b0-...` rather than "comparing shop-postgres...". |

The three flows themselves are short once a user knows where the action lives. The actual
first-time-user stall isn't inside any flow — it's the moment they land on an empty tab with no
copy telling them what an empty state means or where the "new" action for *that specific concept*
lives (Checkouts has none at all; Diffs' and Imports' live in the corner, uncalled-out).

# UI rework: the plan

**Finished.** This is the record of a rework that shipped, not work outstanding. Code comments
cite it for the reasoning behind a screen's shape.

Decided 2026-08-31. Supersedes nothing; this is the first rework since the SPA was built.

## Why

The PRD describes one person who does everything: creates the project, connects the databases,
writes SQL, maps CSV columns, browses S3. That person does not exist. Three people do.

| Person | Role today | What they came for |
| --- | --- | --- |
| Tester | `qa` | Save a state. Go back to a state. Get data out. Put data in. |
| Engineer | `qa` | Inspect the database. Run a query. Compare states. Point an agent at it. |
| Admin | `admin` | Connect the databases. Manage people. Keep the instance well. |

Tester and Engineer hold the same role. The permissions never separated them and do not need to.
The screens are what separate them, and today every screen serves the Engineer.

The proof is the front door: the project page opens on **Adapters**, which is plumbing. GitHub opens
a repository on its files, not on its settings.

## Measured friction, before

| Job | Screens crossed | State |
| --- | --- | --- |
| Create a state | 3 | Good. One required field, sensible defaults. |
| Check out a state | 3 | The Checkouts tab cannot check anything out. The button is on States. |
| Export data | 4 | Impossible without SQL. No export control on the grid. No per-table endpoint exists. |
| Import data | 3 | Works. The vocabulary is code: `emptyToNull`, `uuid`, `now`, "upsert by key columns". |

Two silent traps: an export defaults to 500 rows, caps at 5000, and never shows the truncation
warning on a downloaded file; an import needs **two** presses of Run import, and stopping after the
dry run looks like success.

## Decisions

| Feature | Fate | Reason |
| --- | --- | --- |
| Hooks | **Cut** | 1,079 lines. Fires a saved HTTP request around a checkout. Nobody asked. |
| Saved REST requests | **Cut** | 1,489 lines. Exists so Hooks can work; the database forces the link. |
| Checkouts tab | **Fold into States** | The tab cannot start a checkout. Two tabs, one job. |
| Diffs | Keep, Engineer only | 2,116 lines, self-contained. Testers reset; engineers ask what changed. |
| Storage files | Keep | Cutting it also kills "import from a storage adapter", one of three import sources. |
| Column policies | Keep the engine, hide the screen | Load-bearing, see below. |
| Tools page | **Kept** (the plan said cut) | The service is load-bearing either way, and the page is three PRD stories (131-133) of working hash, secret and UUID generation a tester actually reaches for. Cutting it would have removed a covered feature to save nothing. Reversing this is one route, one nav entry, one view, one spec row. |
| Query history | Cut | Serves none of the three people. |
| Health screen | Fold into Settings | Nothing links to it. You must type the URL. |
| Everything else | Keep | Projects, adapters, states, grid, query, imports, jobs, users, tokens, settings, audit, account. |

### Column policies are not optional

They looked like an easy cut. They are the masking engine. The data grid masks rows with them,
imports validate against them, diffs mask with them, fixture export masks with them. Five services
read one policy list.

The README also promises, in public: "Column policies mask sensitive values before the agent ever
sees them; there is no unmask option." Cut policies and the MCP surface starts serving real
passwords to an AI agent. Keep the engine. Hide the screen behind `admin`.

## Shape

The project page becomes a timeline of states, newest first, with HEAD marked. Every action a
tester needs sits on a row. Adapters move to a settings tab.

```
billing-api                                    [ Take state ]

  ● after-the-failed-refund      HEAD          2h ago
      Check out   Compare   Download
  ○ baseline                                   3d ago
      Check out   Compare   Download

  Adapters (3)   Imports   Jobs   Settings
```

The tab goes into the URL. Today it is a local signal, so a reload always lands on Adapters and a
tab cannot be shared as a link.

## Phases

1. **Cuts.** Hooks and REST out of the SPA, the API, the shared schema, the MCP surface, the docs
   and the database. A `0002` migration drops the four tables; editing `0001` would leave them on
   every installed volume.
2. **Navigation.** States becomes the front door. Checkouts folds into it. The tab enters the URL.
   Diffs and the query console move behind the Engineer surface. Health folds into Settings.
3. **The export gap.** A per-table export endpoint and a button on the grid. Without it the
   tester's third job stays impossible, and no amount of restyling fixes that.
4. **Components.** shadcn as the reference, hand-rolled in plain Tailwind. Icons vendored from
   `lucide-static` (ISC, no dependencies, 2049 SVGs); `lucide-solid` calls `mergeProps` 8,962 times
   and cannot run on Solid 2.

## Progress

| Phase | State | Evidence |
| --- | --- | --- |
| 1. Cuts | done | 3,366 lines out; `/hooks` 404s; no `hook` or `rest` table survives a fresh boot |
| 2. Navigation | done | project opens on States; `?tab=` survives a reload; health folded into Settings |
| 3. Export gap | done | 2,502 of 2,502 rows exported against a live Postgres, where the old path gave 500 |
| 4. Components | done | 67 icons, `EmptyState`, and every screen on the new tokens; `bun run check:classes` gates it |
| 5. E2E | done | the suite is green again, 145/145 stories, and the specs read the screens as they are |

The one deviation from the decisions above is the Tools page, kept rather than cut; the row says why.

## What the E2E repair found

Rewriting the specs against the new screens caught four things the redesign broke and nobody had
noticed, because a spec that cannot find a control fails loudly and a screen that quietly drops a
field does not.

| Regression | Where | Fix |
| --- | --- | --- |
| A state's tags stopped rendering | `states.timeline.view.tsx` | the `<For>` the table had, restored |
| A state named its database count, not its databases | same | `adapterSummary`: two names, then `+N` |
| The commit button read "Import 1 rows" | `imports.wizard.view.tsx` | `commitButtonLabel`, which uses the same `plural` as the rest of the copy |
| The states list and tree had no accessible name | timeline and tree | `aria-label`, which a screen reader needed anyway |

Three more were the rework working as intended, and only the specs were wrong: a ready state prints
no badge (wait for its Check out button instead), a succeeded checkout reads "restored", and a
manifest says "primary key order" rather than `primary-key`.

The crawler also found two defects in the grid that had nothing to do with the restyle:
**Add filter** submitted an empty value, which the API refuses and which threw the whole screen
into its error boundary, and `fkLink` built the same dead link for an FK holding an empty string.
Both refuse in place now, and `filterNeedsValue` states the API's own rule once.

## Known, accepted

- ~~The `buttons.e2e.ts` crawler only clicks `main button:visible`, and a `<summary>` is not a
  button.~~ Closed. The overflow menu became a popover opened by a real `<button>` when the row
  menus were rebuilt, so the crawler reaches those actions again.

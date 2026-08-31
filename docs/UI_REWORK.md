# UI rework: the plan

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
| Tools page | Cut the page, keep the service | `tools.service.ts` feeds row generators and import transforms. |
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

## Known, accepted

- **The browser suite breaks and stays broken until phase 4 ends.** This is deliberate and was
  instructed. `.e2e/coverage.md` and the "0 uncovered UI" claim are stale from phase 1 onward.
- The `design-system` skill documents the look as it is today. Phase 4 stales it; updating it is
  part of phase 4, not an afterthought.

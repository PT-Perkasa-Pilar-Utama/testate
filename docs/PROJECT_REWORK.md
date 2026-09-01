# Project page rework

The project page carried five sibling tabs that were not siblings: States, Imports, Diffs,
History, Adapters. This is the plan that replaces them, agreed in full before any code, and the
record of what has been built.

## What the domain actually says

Three premises were wrong before this plan and are worth writing down, because the old navigation
was built on them.

| Believed | Actually |
| --- | --- |
| History belongs to states | "History" is the checkouts list. `checkouts` is `project_id` + `state_id` + `job_id` + `status`: a record that a state **was put back**. An event referencing a state, not a child of one. |
| A diff is per state | A diff is a **pair**. `diffs.base_state_id` plus `target_state_id` or `live_state_id`. It also carries `expires_at`, swept at `retention.diff_days` (7), so it is a transient working result and not a durable object. |
| An import is per table | An import mapping is per **adapter**: `import_mappings.adapter_id`, unique on `(adapter_id, name)`. Tabular only. The table is the target inside the adapter. |

And one the code settled: a storage adapter is not a project primitive. `states.service.ts` lists
`{ kind: "database" }` when it takes a snapshot, so a file store never enters a state, never gets
checked out, and never appears in a diff. Its only tie to a project is the `project_id` column.

The verified model:

```
project
├── databases ────────── the connections. Nothing exists without one.
│     ├── tables · query · masks
│     └── imports                              (mappings + runs)
├── states ───────────── snapshots. Many adapters each. parent_state_id is a real tree.
└── events that reference states
      ├── checkouts   "this state was put back"
      ├── diffs       "these two states compared"     expires in 7 days
      └── import runs "this file went into that adapter"

storage adapters ─────── their own menu. Used as an import source and browsed directly.
```

`states.stash_reason IN ('checkout', 'import', 'write-session')` is the schema already saying the
last group is one thing. `states.kind = 'diff'` with `owner_diff_id` means diffs create states
too, so it is a loop at the edges rather than a strict tree.

## Navigation

```
sidebar                    project page                adapter page
  Home                       States                      tables · query · imports · masks
  Projects                   Activity
  Storage      <- new        Databases    <- was "Adapters"
  Jobs
  Tools
  Audit
  Users
  Tokens
  Settings
```

## Phases

| # | Phase | Status | Commit |
| --- | --- | --- | --- |
| 1 | Storage gets its own menu; project tab becomes Databases | pending | |
| 2 | Project tabs five to three, with `?tab=` redirects | pending | |
| 3 | Activity: chips over the three existing lists | pending | |
| 4 | Imports move under the adapter and shrink to one screen | pending | |
| 5 | States: tree by default, rows link, select to compare | pending | |
| 6 | Each state row carries what it produced | pending | |
| 7 | Policies becomes Column masks | pending | |
| 8 | ERD: a List / Diagram toggle on the adapter page | pending | |
| 9 | Diff full page: split panes, changed cells, value diff | pending | |

### 1. Storage its own menu

A sidebar entry listing every file store across projects, with the project as a column. The
project's Adapters tab drops storage kinds and is renamed Databases. No migration: `project_id`
stays, so a project-scoped token still sees only its own stores.

### 2. Tabs five to three

`PROJECT_TABS` becomes States, Activity, Databases. `?tab=checkouts` and `?tab=diffs` redirect to
`activity`; `?tab=imports` redirects to the adapter's imports route, or to `activity` when the
project has no database adapter yet.

### 3. Activity

One tab, chips for All / Checkouts / Diffs / Imports over the three existing lists, each keeping
its own cursor and endpoint. No API work. A merged feed would need a union endpoint across three
tables and was declined for that reason.

### 4. Imports

Moves to `/projects/:slug/adapters/:id/imports`, one more sub-route beside query and masks. The
wizard's "Database" select disappears because the adapter is in the URL.

One screen, not four steps:

```
File          [ customers.csv ]              drop or browse
Table         [ public.customers      v ]
What happens  (o) Add rows   ( ) Replace everything in the table
Columns       12 of 12 matched by name             > Adjust
Preview       5 rows                          [ Import 1 204 rows ]
```

The column panel, when opened:

```
File column   id       name     birth_date        password
Sample        1        Dina     03/04/2026        hunter2
Goes to       id       name     birth_date        password_hash
Read as     [Auto v] [Auto v]  [Date · dd/MM v]  [Bcrypt v]
```

- **Auto** is the default. It trims, turns an empty cell into NULL where the column is nullable,
  and otherwise hands the string to the column's own type. Postgres parses `2026-01-31` into a
  date column by itself, which is why auto covers most files.
- **Date** describes the **source**, never the target. `03/04/2026` is 3 April or 4 March and only
  the file's author knows; the target is never ambiguous because the column has a type. The
  timezone is the second half of the same question. This is what the engine already does:
  `{ kind: "date", format, timezone }` goes to `parseDate(text, format, timezone)`.
- **Number** for `1.234,56` and other locale forms. **Text** to force a string. **Hash** runs one
  of the existing functions (bcrypt, argon2id, sha256) before insertion.
- The sample row exists because the header alone cannot answer the date question.
- Upsert, key columns, transforms beyond the four, and saved mappings live behind `> Adjust`.

### 5. States

Tree becomes the default view and its rows become links, which is a plain defect: the tree renders
a name and badges with no click handler at all today. Checkbox selection replaces the New diff
dialog: two selected offers Compare, one offers Compare with live. HEAD is marked in both views,
and `head_status = 'unknown'` after a failed restore says so on the row instead of staying silent.

### 6. Row counts

Each state shows what it produced: restored *n* times, in *m* diffs. Two grouped counts folded
into the states list response rather than a second round trip.

### 7. Column masks

The policies screen does two unrelated things. The mask half earns its place: a test database
holds real-looking emails and card numbers, and an agent copies values into prompts. The required
function half covers forms, grid edits and import mappings but silently not raw SQL, which spec
24 admits. The screen becomes **Column masks** and does one thing; required functions leave the
UI and their enforcement stays in the API.

### 8. ERD

A List / Diagram toggle on the adapter page, the shape States already uses for List / Tree.
Introspection already carries what a box needs: columns with type and nullability, the primary
key, and foreign keys both ways. So the graph is free and the work is rendering.

No new dependency. Nearly every diagram library is React-first and this is Solid 2 RC.

```
canvas    SVG in a div, one transform: translate(x,y) scale(z)
pan       pointer drag  ->  signal
zoom      wheel         ->  scale signal
layout    layered by FK depth: no outgoing FK is layer 0, otherwise
          max(referenced) + 1, cycles capped
```

Auto-layout only: no dragging, nothing persisted, nothing to go stale when a column is added. An
auto ERD of two hundred tables is a hairball in every tool, so everything is drawn when the schema
is small and otherwise it starts at one table and expands along its foreign keys.

### 9. Diff page

`/projects/:slug/diffs/:id`, replacing today's dialog. No API work: `GET /diffs/:id/rows` already
answers with `{ op, before, after, changed_columns }`, so the server already says which columns
changed.

```
  orders-db                     public.orders          +12  -3  ~48
  |- public.orders    +12 -3 ~48
  |- public.customers  +0 -0  ~2    id     status       total
  `- public.payments   +4 -0  ~0    ------------------------------
                                    88213  paid→failed  42.00
     added    green, right only     88214  —            (added)
     removed  red, left only        88190  (removed)    —
     changed  both, cells tinted
```

Split panes for rows, because a row is wide. Clicking a changed cell opens the value itself, and
there unified reads better: JSON and JSONB are pretty-printed and compared line by line.

## Costs

No migrations. 27 tab references across five e2e specs break and are updated with the phase that
breaks them; the suite is not run until asked. Phases 4, 8 and 9 are the real work.

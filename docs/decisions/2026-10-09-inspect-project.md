# The built-in Inspect project (#56): decisions

Date: 2026-10-09

| # | Question | Decision | Why |
|---|----------|----------|-----|
| Q1 | Name and slug? | **Inspect**, slug `inspect`. The dashboard marks it apart from regular projects. | "Debug" suggests fixing, which usually means writing; "Inspect" says look, don't touch. |
| Q2 | How does it come to exist? | Migration 0010 adds `projects.kind` (`standard` \| `inspect`, default `standard`). Boot, right after the bootstrap admin, runs an idempotent "ensure Inspect" step; reset-state runs it too. The step finds the row by `kind`, creates it if missing with `created_by` = the bootstrap admin, and takes slug `inspect`, or `inspect-2` when an existing project holds it. `inspect` joins the reserved slugs. Code keys on `kind`, never on the slug. | Migrations run before the admin exists and `projects.created_by` is a required user reference (0001), so a migration cannot insert the row. No table rebuild, no fake system user, and an existing `inspect` project keeps its slug. |
| Q3 | Who may add adapters? | Testers and admins, as on any project, within their project scope. | Nothing in Inspect can write; adding a connection is the only risk, and testers add connections everywhere else. |
| Q3b | Who controls an adapter in Inspect? | Migration 0010 adds `adapters.created_by` (nullable, set null when the user is deleted). In Inspect, editing, deleting and changing column policies need the creator or an admin; anyone else gets 403 `not_adapter_owner`. Test, retest, browse and query stay open to everyone in scope. An adapter with no owner is admin-only. | An Inspect adapter is one person's "point my agent here" connection. Another tester retargeting it, deleting it, or removing a mask Tina's agent relies on is the harm to prevent. |
| Q3c | Owner-only adapters in regular projects too? | No. `created_by` is recorded on every adapter and shown as "Added by", but enforced only in Inspect. | In a regular project testers collide through checkouts, imports and writes, which adapter ownership does not stop, and adapters there are shared: one absent owner would block every checkout of the project. |
| Q4 | What does Inspect refuse beyond read-only adapters, where, and with which code? | New code `PROJECT_READ_ONLY`, 403. Refused: taking a snapshot, importing a state archive, diffs, checkouts, imports (dry runs too), uploads, normalizers. Allowed: adapter create, edit, test, retest, delete; browsing, read-only queries and export; fixtures; saved queries; column policies. One `assertProjectWritable(project)` helper, called inside the refusing services (states, diffs, checkouts, imports), so REST and the MCP write tools share one rule. | Forced `read_only` adapters already refuse writes to targets (`ADAPTER_READ_ONLY`); what is left writes Testate's own records. An HTTP middleware would miss `/mcp`, which skips the route guards. 403 matches `ADAPTER_READ_ONLY`: the request is well formed, the project refuses it. |
| Q5 | Adapters in Inspect? | Always `read_only`: no mode means `read_only`, a sent `sandbox` is refused with `PROJECT_READ_ONLY`, and `POST .../mode` is refused for everyone. No init snapshot on create or retarget, and no at-init precondition. Deleting one is a plain removal. The add form hides the mode field and says Testate never writes here. | The mode is the guarantee, so it cannot be switched off, and silently changing a sent `sandbox` would hide a client's mistake. Nothing in Inspect is ever restored, so an init state has no use. |
| Q6 | Which tokens may be scoped to Inspect? | A token whose `project_ids` lists Inspect must be a viewer, either kind; otherwise 400 `VALIDATION_ERROR` on `role`, "A token that reaches Inspect is a viewer." Mixed lists follow the same rule. "All projects" tokens of any role are allowed. Users are not restricted. | Validation error, like the scope-required refusal of #55, so the dialog shows it under the field. An all-projects token still meets `PROJECT_READ_ONLY` and read-only adapters in Inspect. A person needs their role for other projects; a token is cheap to split. |
| Q7 | The Inspect screen and immutability? | PATCH, deletion plan and delete on Inspect answer `PROJECT_READ_ONLY`, admins included. Header: eye icon and an `info` badge "Built in · read-only"; no HEAD, Snapshot or settings gear; one line on its purpose linking to "Make an agent token". No tabs: the Databases list is the page. Adapter screens drop Import, write sessions, row edits and the mode switch; Edit and Delete only for the owner or an admin, with "Added by". Inspect file stores appear in the Storage menu with the badge and without upload, rename or delete. | One look says this place only reads, and no control is shown that would only be refused. States and Activity would always be empty. |
| Q8 | Lists and empty states? | `GET /projects` returns Inspect with a new `kind` field and accepts a `kind` filter. The Projects screen shows Inspect as a card above a table that asks for `kind=standard`. "No projects yet" and Home's project list and stat count standard projects only; Home links to Inspect beside them. Scope pickers list Inspect first with the badge. Scope applies everywhere. | Inspect is a utility next to the projects, not one of them; a fresh install should still invite the first real project, and paging should never hide Inspect. |
| Q9 | Making an Inspect token easy? | An "Inspect only" button in the New token dialog sets kind Agent, role Guest and Chosen projects = [Inspect]. `/tokens?new=inspect` opens the dialog filled that way, linked from the Inspect screen. Ticking Inspect locks the role to Guest with a line saying why; unticking unlocks it. "All projects" and the user dialogs lock nothing. | The main path is one click, and the dialog never offers what the API refuses. |

Stated from the code, not asked:

- Who sees Inspect: an ordinary project for scope (`docs/decisions/2026-10-09-project-scope.md`).
- Storage writes in Inspect: `read_only` already refuses insert, rename and delete (`storage.service.ts:118-130`).
- The existing read-only refusals keep their code `ADAPTER_READ_ONLY`; `PROJECT_READ_ONLY` covers what a read-only adapter does not.

## Deferred

| Branch | Reason | Who decides |
|--------|--------|-------------|
| Testers overwriting each other's data in regular projects | Needs real cases; the fix is about who may check out or write over whose work, not adapter ownership (Q3c) | Tech Lead, as its own issue |
| A second `inspect`-kind project | `kind` keeps it possible; nothing asks for it | Later |

## Docs changed

- docs/GLOSSARY.md: added **Inspect project**.
- To change during the build: `05-module-definitions.md` (projects, adapters, agent), `06-data-model.md` (projects.kind, adapters.created_by), `23-agent-access.md`, `api-specs/01-conventions.md` (PROJECT_READ_ONLY), `04-projects.md`, `05-adapters.md`, `02-authentication.md` §2.7, `PRD.md` (a story).

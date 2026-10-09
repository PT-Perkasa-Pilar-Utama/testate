# Project scope for tokens and users (#55): decisions

Date: 2026-10-09

| # | Question | Decision | Why |
|---|----------|----------|-----|
| Q1 | Which roles can be scoped? | Viewers and testers only. An admin always has every project. | An admin manages users, tokens, and settings for the whole instance; a scoped admin contradicts the role. The admin-only routes already refuse a scoped caller. |
| Q2 | How is a user's scope stored? | A join table `user_projects(user_id, project_id)` with `ON DELETE CASCADE` on both keys, plus `users.all_projects` (0 or 1) for every project. Tokens keep their `project_ids` column. | Deleting a project removes its access rows by itself. A flag for "all" leaves "no rows" with one meaning: no projects. |
| Q3 | What do existing and new users get? | The migration gives every existing user every project. A new viewer or tester has no default: the dialog and the API refuse until every project or a list (possibly empty) is chosen. The Users screen shows an "All projects" badge. | Nobody is locked out on upgrade, and nobody new gets access nobody chose. |
| Q4 | Does `POST /tokens` require `project_ids`? | Yes, for both kinds: an array (possibly empty) or an explicit `null` for every project. Leaving it out answers 400 `VALIDATION_ERROR` and names the field (the API's code for a bad body). Breaking change, announced in the changelog. | An unscoped token has to be a choice. Our own callers that leave it out (`e2e/api.e2e.ts:141`, the token dialog) are updated. |
| Q5 | What does deleting a project do to scoped tokens and users? | Remove only that project from each scope. A token is revoked only when its scope becomes empty. A user loses the access row through the cascade and stays active. | Revoking the whole token (`jobs.runners.ts:103-106` today) broke a token that still served other projects. |
| Q6 | Who can create a project, and who sees it? | Only a signed-in user; `POST /projects` refuses tokens (403). A scoped tester who creates one gets an access row for it in the same transaction. Users with every project see it; other scoped users do not until an admin adds it. | A token cannot satisfy `projects.created_by REFERENCES users(id)` (migration 0001), so token-created projects fail today. The creator must see what they made. |
| Q7 | Can a viewer or tester have no projects? | Yes. They sign in to an empty project list that says an admin has to give access; every project URL is 404. | A new hire waiting for access, or a user whose last project was deleted (Q5). |
| Q8 | Where does an admin manage a user's access? | In the new-user and edit-user dialogs, with the same project picker as tokens and "All projects" as an explicit choice. | One shared picker for tokens and users. Nothing in #55 or #56 needs a per-project view. |
| Q9 | What scope does an admin get when demoted? | The role change must say: `PATCH /users/:id` that turns an admin into a viewer or tester refuses without a scope (400 `VALIDATION_ERROR`), and the edit dialog shows the picker when the role changes. Promotion to admin needs nothing; access rows are ignored for admins. | Keeping every project silently would hand access nobody chose, as in Q3 and Q4. |

Stated from the code, not asked:

- Gaps found while mapping enforcement are fixed in #55, because once sessions carry scope some of them reach users:
  - G1: `POST /admin/reset-state` gets `requireUnscoped`.
  - G2: instance jobs (backup, store migration) are visible to unscoped admins only, the same rule for list, get, stream, and `?wait`.
  - G3: covered by Q6.
  - G4: `/health` gives the full report to unscoped admins only.
  - G5: `api-specs/15-audit-logs.md` is corrected to match the code (instance rows for admins).
- Storage and later tiers inherit scope through their project: `/storage-adapters` already filters by scope (`adapters.stores.ts:23`). It gets a test.
- `fromSession` (`auth.service.ts:229`) is the single place a session's scope is set; every existing check reads `projectScope`, so user scope uses the token enforcement unchanged.
- #56 is not blocked: access to the Inspect project is an access row like any other project's.

## Deferred

| Branch | Reason | Who decides |
|--------|--------|-------------|
| A per-project "who has access" screen | A second view of the same data; nothing in #55 or #56 needs it | Tech Lead, as a later issue |

## Docs changed

- docs/GLOSSARY.md: added **Project scope**.
- To change during the build: `09-authentication.md` §9.4 ("A user is never scoped") and §9.5 (`actor.projectIds`, G6), `06-data-model.md` (users, user_projects), `api-specs/02-authentication.md` and the tokens and users sections, `api-specs/04-projects.md:87` (Q5), `api-specs/15-audit-logs.md` (G5), `PRD.md` (a user-scope story; the token-deletion wording).

# Testers overwriting each other (#60): decisions

Date: 2026-10-11

Every question below was decided by the advisor at the user's request.

## The cases

No incident was reported. These are the paths the code permits.

| #   | Case                                                        | What the code does                                                                                                   |
| --- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| C1  | Two checkouts on one adapter                                | `jobs.dispatcher.ts` runs them one after the other. The second wins. No race, but the first tester is not told       |
| C2  | A checkout over another tester's work in progress           | The preflight takes a stash first, so the work can come back. Nobody tells the first tester it went                  |
| C3  | An import or a write session on a database someone else uses | `head.dirty` turns on. Nothing names who wrote                                                                       |
| C4  | Uploading, renaming or deleting files someone else staged   | The audit log records it. Nothing shows it at the moment of the write                                               |
| C5  | Retargeting or deleting an adapter others use                | `created_by` is recorded, not enforced (Q3c of `2026-10-09-inspect-project.md`)                                     |

## Decisions

| #   | Question                                   | Decision                                                                                                                                                                                       | Why                                                                                                                                                       |
| --- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Warn or lock?                              | Warn                                                                                                                                                                                           | A lock held by someone who is away blocks every checkout of the project, and nothing can tell away from working. Jobs already run one at a time per adapter, and a checkout already stashes, so a lock guards against loss that is mostly impossible |
| Q2  | What does the warning say?                 | The last change to the project's data by someone else: who, what, on which adapter, and when. "Tina checked out `before-refund` 4 minutes ago"                                                | The person judges 4 minutes against 2 days. A cutoff would be a setting for a value nobody tunes                                                          |
| Q3  | Which acts count as a change?              | `checkout.created`, `import.run` without a dry run, `write_session.started`, and `file.uploaded`, `file.renamed`, `file.copied`, `file.deleted`                                                | These are the acts that change live data (C1 to C4). A snapshot, a diff and a read change nothing                                                         |
| Q4  | Does an agent token count?                 | Yes. Any actor other than the caller counts, a token included. The warning names the token by its label                                                                                         | An agent that writes is a tester for this purpose. `actorSchema` already carries the kind, the label and the agent flag                                   |
| Q5  | Where does the data come from?             | The audit log: the newest matching row for the project whose actor is not the caller. One query, on the existing `audit_logs_project` index. No new table                                     | Every act in Q3 is already audited. A row past the audit retention (`audit_days`) is gone, and then there is no warning                                   |
| Q6  | How does the SPA get it?                   | `GET /projects/{slug}/last-change`, viewer and up, scoped like the audit list. It answers `{ last_change: null }` when nobody else changed anything                                            | One endpoint serves every screen in Q7. The audit list is already readable by viewers, so it shows nothing new                                           |
| Q7  | Where does the warning show?               | The checkout dialog, the import wizard's run step, and the grid's Start writing control                                                                                                       | These are the moments a tester is about to overwrite (C1 to C3). C4 is covered by Q3 but has no confirm step to hold a banner                             |
| Q8  | Adapter retarget and delete?               | Out of scope                                                                                                                                                                                   | Q3c decided it, and this issue does not reopen it                                                                                                         |
| Q9  | Decision only, or build it?                | Build it in the same PR                                                                                                                                                                        | The issue's Done-when asks for the decision only. The build is one query, one endpoint and one banner, which is smaller than a follow-up issue           |


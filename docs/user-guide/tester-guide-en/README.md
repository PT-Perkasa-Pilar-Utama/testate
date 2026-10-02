# Testate tester guide

This guide is for people with the **Tester** role. You do not need to know SQL or databases to use most of it. Each picture comes from the real app. The orange numbers on a picture match the numbers in the table under it.

Versi Bahasa Indonesia: [tester-guide-id](../tester-guide-id/README.md).

## Contents

1. [Sign in](01-sign-in.md)
2. [Your daily routine: save, test, reset](02-daily-routine.md)
3. [Look after your states](03-states.md)
4. [Look at the data](04-look-at-data.md)
5. [Change the data](05-change-data.md)
6. [Compare two points in time](06-compare.md)
7. [Files, jobs and tools](07-files-jobs-tools.md)
8. [Set up a new project](08-new-project.md)
9. [Problems and help](09-troubleshooting.md)

## What Testate does

Every test run changes the data in the test database. Before the next run, someone must put the data back. Testate does that for you, with one click.

```
  1. Snapshot            2. Test                3. Check out
  ┌──────────────┐       ┌──────────────┐       ┌──────────────┐
  │ Save the data│ ────▶ │ Run your test│ ────▶ │ Put the saved│
  │ as a "state" │       │ (data change)│       │ data back    │
  └──────────────┘       └──────────────┘       └──────────────┘
         ▲                                              │
         └───────────── repeat as often as you need ────┘
```

### Words you will see

| Word | What it means | Example |
| --- | --- | --- |
| **Project** | One system under test. It holds the databases and the states. | "Payment service SIT" |
| **Database** (also **adapter**) | One connection from Testate to a real database or file store. | `shop-postgres` |
| **State** | Saved data of every database in the project at one moment. | `before-payment-test` |
| **Snapshot** | The button that saves a new state. | |
| **Check out** | Put the data of a state back into the live databases. | |
| **HEAD** | The state that the live databases match now. | `HEAD before-payment-test` |
| **Stash** | A state that Testate saves by itself before it changes data. You use it to undo. | `stash-2026-10-02T13-50-20…` |
| **Starting point** (`init`) | The first state. Testate saves it when a database joins the project. Nobody can delete it. | `init` |
| **Compare** (diff) | A list of the rows that are different between two points. | 4 rows added |
| **Sandbox** / **Read-only** | Sandbox lets you change data. Read-only lets you only look. | |

---

Start with: [Sign in](01-sign-in.md) →

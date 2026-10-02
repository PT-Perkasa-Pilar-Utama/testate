# Your daily routine: save, test, reset

## Open your project

Click **Projects** in the side menu.

![Projects list](../images/05-projects.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | Project name | Click it to open the project. |
| 2 | **Filters** | Show only some projects. |
| 3 | **New project** | Make a new project. See [Set up a new project](08-new-project.md). |

## The project screen

![Project screen](../images/07-project.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | **Snapshot** | Save the data now as a new state. |
| 2 | **HEAD** and **Quota** | HEAD is the state the databases match now. **modified** means the data changed after it. Quota is the space your states use. |
| 3 | Tabs | **States** lists the saved states. **Databases** lists the connections. **Activity** lists the history. |
| 4 | **List** / **Tree** | Two views of the same states. **Tree** shows which state came from which. |
| 5 | **Check out** | Put the data of this state back. |
| 6 | **Show stashes** | Also show the states that Testate saved by itself. |
| 7 | **Compare** | Find what changed between two points. See [Compare two points in time](06-compare.md). |

## Step 1: save the data (Snapshot)

Do this before you start a test.

1. Click **Snapshot**.
2. Fill in the form.
3. Click **Take**.

![Snapshot form](../images/08-snapshot.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | **Name** | Type a short name. Each name must be different in a project. Example: `before-payment-test`. |
| 2 | **Notes** | Optional. Write why you saved it. |
| 3 | **Tags** | Optional. A label to find the state later, for example a sprint or a bug number. |
| 4 | **In the frame** | The databases that go into the state. Testate always takes all of them. |
| 5 | **Take** | Click it. Testate saves the state in the background. |

After some seconds, the new state is at the top of the list.

![State list](../images/09-states-list.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | State name | Click it to see the state. See [Look after your states](03-states.md). |
| 2 | **HEAD** | The live databases match this state now. |
| 3 | Tag | The tag you typed. |
| 4 | **Check out** | Put the data of this state back. |
| 5 | **⋯** menu | More actions: **Check for changes**, **Download**, **Edit**, **Protect**, **Delete**. |

## Step 2: run your test

Use your application as usual. Testate does nothing in this step.

When the data changes, the HEAD label says **modified**. Example: `before-payment-test · modified`. This means the live data is no longer the same as the state.

## Step 3: put the data back (Check out)

1. Open the **States** tab.
2. Find the state that you want.
3. Click **Check out**.
4. Read the window that opens.
5. Click **Check out** in the window.

![Check out window](../images/23-checkout.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | Stash message | Testate saves the current data first, as a stash. You can undo the checkout with it. |
| 2 | Database list | Each database and its schema check. **schema matches** means the table layout is the same. |
| 3 | **Force past schema drift** | Use it only when the table layout changed. Read [When something goes wrong](09-troubleshooting.md#when-something-goes-wrong) first. |
| 4 | **Check out** | Click it to start. |

> **Caution:** A checkout replaces the live data in every database of the project. Tell the other people who use the same test database before you start.

**Restore method per database** shows how Testate writes each database. It tells you if the restore locks tables. It also tells you if other users can see a half-done restore, as on MongoDB. Read it before you check out a database that other people use.

## See the result of a checkout

Open the **Activity** tab, then **Checkouts**.

![Checkout history](../images/24-checkouts.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | **Checkouts** | The list of all checkouts in this project. |
| 2 | State | The state that Testate put back. |
| 3 | **Result** | **Succeeded** means every database is back. **Failed** means one or more did not finish. |
| 4 | **Details** | See the result of each database. |
| 5 | **Counters** | Testate resets the ID counters after a checkout. Click it to see the result. If that step failed, repair the counters there. |
| 6 | **Retry** | Run the checkout again for the databases that failed. Testate enables it only after a failure. |

## Undo a checkout (stash)

Before each checkout, import, or first edit, Testate saves a stash. To go back:

1. Open the **States** tab.
2. Click **Show stashes**.
3. Find the stash with the time just before your change.
4. Click **Check out** on that stash.

![Stashes shown](../images/25-stashes.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | **Show stashes** | Turn it on to show the stashes in the list. |
| 2 | Stash | Its name contains the date and time. It lists the databases it holds. |
| 3 | **Check out** | Put the data of the stash back. |

> **Note:** Testate keeps only the most recent stashes. It deletes older stashes automatically. Save a real state with **Snapshot** for data that you need for a long time.

---

← Previous: [Sign in](01-sign-in.md) · [Contents](README.md) · Next: [Look after your states](03-states.md) →

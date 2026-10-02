# Testate tester guide

This guide is for people with the **Tester** role. You do not need to know SQL or databases to use most of it. Each picture comes from the real app. The orange numbers on a picture match the numbers in the table under it.

Versi Bahasa Indonesia: [tester-guide-id.md](tester-guide-id.md).

## Contents

1. [What Testate does](#1-what-testate-does)
2. [Sign in](#2-sign-in)
3. [Your daily routine: save, test, reset](#3-your-daily-routine-save-test-reset)
4. [Look after your states](#4-look-after-your-states)
5. [Look at the data](#5-look-at-the-data)
6. [Change the data](#6-change-the-data)
7. [Compare two points in time](#7-compare-two-points-in-time)
8. [Files](#8-files)
9. [Jobs and tools](#9-jobs-and-tools)
10. [Set up a new project](#10-set-up-a-new-project)
11. [When something goes wrong](#11-when-something-goes-wrong)
12. [What only an administrator does](#12-what-only-an-administrator-does)

## 1. What Testate does

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

## 2. Sign in

### 2.1 Sign in the first time

Your administrator gives you a username and a temporary password.

![Sign-in form](images/01-sign-in.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | Username | Type the username from your administrator. |
| 2 | Password | Type the temporary password. |
| 3 | **Sign in** | Click it. |

The first time, Testate asks you to choose your own password.

![Choose a new password](images/02-new-password.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | **Current password** | Type the temporary password again. |
| 2 | **New password** | Type a new password. Use 12 characters or more. |
| 3 | **Save password** | Click it. Testate opens the Home screen. |

> **Note:** After five wrong passwords, Testate locks your account for 15 minutes. Wait, or ask your administrator.

### 2.2 The Home screen

![Home screen](images/03-home.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | Side menu | Go to **Home**, **Projects**, **Storage**, **Jobs**, or **Tools**. |
| 2 | **Projects** | Click a project to open it. The green label shows its HEAD. |
| 3 | **Running now** | Work that Testate does at this moment, for example a snapshot. |
| 4 | **Needs attention** | Work that failed. Open it and read the error. |
| 5 | Your name | Click it to open your account menu. |

### 2.3 Your account menu

![Account menu](images/04-account-menu.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | **Account** | Change your password and see your sessions. |
| 2 | **Theme** | Click to change between system, light, and dark colours. |
| 3 | **Sign out** | Click it when you finish. |

### 2.4 Change your password later

Open **Account** from the account menu.

![Account screen](images/29-account.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | **Current password** | Type your password now. |
| 2 | **New password** | Type the new password, 12 characters or more. |
| 3 | **Save password** | Click it. Testate signs you out on every other device. |
| 4 | **Sessions** | Each device that uses your account now. Click **Sign out** on a device that you do not know. |

## 3. Your daily routine: save, test, reset

### 3.1 Open your project

Click **Projects** in the side menu.

![Projects list](images/05-projects.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | Project name | Click it to open the project. |
| 2 | **Filters** | Show only some projects. |
| 3 | **New project** | Make a new project. See [section 10](#10-set-up-a-new-project). |

### 3.2 The project screen

![Project screen](images/07-project.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | **Snapshot** | Save the data now as a new state. |
| 2 | **HEAD** and **Quota** | HEAD is the state the databases match now. **modified** means the data changed after it. Quota is the space your states use. |
| 3 | Tabs | **States** lists the saved states. **Databases** lists the connections. **Activity** lists the history. |
| 4 | **List** / **Tree** | Two views of the same states. **Tree** shows which state came from which. |
| 5 | **Check out** | Put the data of this state back. |
| 6 | **Show stashes** | Also show the states that Testate saved by itself. |
| 7 | **Compare** | Find what changed between two points. See [section 7](#7-compare-two-points-in-time). |

### 3.3 Step 1: save the data (Snapshot)

Do this before you start a test.

1. Click **Snapshot**.
2. Fill in the form.
3. Click **Take**.

![Snapshot form](images/08-snapshot.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | **Name** | Type a short name. Each name must be different in a project. Example: `before-payment-test`. |
| 2 | **Notes** | Optional. Write why you saved it. |
| 3 | **Tags** | Optional. A label to find the state later, for example a sprint or a bug number. |
| 4 | **In the frame** | The databases that go into the state. Testate always takes all of them. |
| 5 | **Take** | Click it. Testate saves the state in the background. |

After some seconds, the new state is at the top of the list.

![State list](images/09-states-list.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | State name | Click it to see the state. See [section 4](#4-look-after-your-states). |
| 2 | **HEAD** | The live databases match this state now. |
| 3 | Tag | The tag you typed. |
| 4 | **Check out** | Put the data of this state back. |
| 5 | **⋯** menu | More actions: **Check for changes**, **Download**, **Edit**, **Protect**, **Delete**. |

### 3.4 Step 2: run your test

Use your application as usual. Testate does nothing in this step.

When the data changes, the HEAD label says **modified**. Example: `before-payment-test · modified`. This means the live data is no longer the same as the state.

### 3.5 Step 3: put the data back (Check out)

1. Open the **States** tab.
2. Find the state that you want.
3. Click **Check out**.
4. Read the window that opens.
5. Click **Check out** in the window.

![Check out window](images/23-checkout.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | Stash message | Testate saves the current data first, as a stash. You can undo the checkout with it. |
| 2 | Database list | Each database and its schema check. **schema matches** means the table layout is the same. |
| 3 | **Force past schema drift** | Use it only when the table layout changed. Read [section 11](#11-when-something-goes-wrong) first. |
| 4 | **Check out** | Click it to start. |

> **Caution:** A checkout replaces the live data in every database of the project. Tell the other people who use the same test database before you start.

**Restore method per database** shows how Testate writes each database. It tells you if the restore locks tables. It also tells you if other users can see a half-done restore, as on MongoDB. Read it before you check out a database that other people use.

### 3.6 See the result of a checkout

Open the **Activity** tab, then **Checkouts**.

![Checkout history](images/24-checkouts.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | **Checkouts** | The list of all checkouts in this project. |
| 2 | State | The state that Testate put back. |
| 3 | **Result** | **Succeeded** means every database is back. **Failed** means one or more did not finish. |
| 4 | **Details** | See the result of each database. |
| 5 | **Counters** | Testate resets the ID counters after a checkout. Click it to see the result. If that step failed, repair the counters there. |
| 6 | **Retry** | Run the checkout again for the databases that failed. Testate enables it only after a failure. |

### 3.7 Undo a checkout (stash)

Before each checkout, import, or first edit, Testate saves a stash. To go back:

1. Open the **States** tab.
2. Click **Show stashes**.
3. Find the stash with the time just before your change.
4. Click **Check out** on that stash.

![Stashes shown](images/25-stashes.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | **Show stashes** | Turn it on to show the stashes in the list. |
| 2 | Stash | Its name contains the date and time. It lists the databases it holds. |
| 3 | **Check out** | Put the data of the stash back. |

> **Note:** Testate keeps only the most recent stashes. It deletes older stashes automatically. Save a real state with **Snapshot** for data that you need for a long time.

## 4. Look after your states

Click the name of a state to open it.

![State screen](images/10-state.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | **Check out** | Put the data of this state back. |
| 2 | **Compare with live** | Find what changed since you saved this state. **Compare with…** compares it with another state. |
| 3 | **Download** | Save the state as one archive file, for example to keep a copy outside Testate. |
| 4 | **Edit** | Change the name, notes, or tags. |
| 5 | **Protect** | Stop all users from deleting this state. Click **Unprotect** to remove the protection. |
| 6 | **Delete** | Delete the state and free its space. You cannot delete a protected state. |
| 7 | Tables | The tables in each database, with the row count. **same** means no change from the parent state. |

Protect the states that your team uses again and again, for example a clean baseline.

**Check for changes** (in the **⋯** menu of the HEAD state) compares the HEAD state with the live data.

## 5. Look at the data

### 5.1 The databases of a project

Open the **Databases** tab.

![Databases tab](images/11-databases.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | Starting point message | You can add a database only when the project is on its starting point. Click **Check out the starting point** first. |
| 2 | Database name | Click it to open the database. |
| 3 | **Mode** | **Sandbox** lets you change data. **Read-only** lets you only look. |
| 4 | **Status** | **OK** means Testate can connect. |

### 5.2 One database

![Database screen](images/12-adapter.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | Table name | Click it to see the rows. |
| 2 | **Import** | Load a CSV or Excel file into this table. See [section 6.2](#62-import-a-csv-or-excel-file). |
| 3 | **Query console** | Write a query to read data. |
| 4 | **List** / **Diagram** | **Diagram** shows how the tables link to each other. |
| 5 | **Retest connection** | Check the connection again, for example after a password change. |
| 6 | **Edit adapter** | Change the name, the excluded tables, or the connection details. Ask a developer for the connection details. |

**ROWS (EST.)** is an estimate from the database. Open the table to see the real rows.

### 5.3 Browse a table

![Table rows](images/13-grid.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | Filter | Select a column and a condition, type a value, then click **Add filter**. You can add more than one filter. |
| 2 | **Export CSV** / **Export JSON** | Download the rows as a file. |
| 3 | **Write mode** | Turn it on to change rows. See [section 6.1](#61-change-rows-by-hand). |
| 4 | Column names | Click a column name to sort by it. |
| 5 | Pages | Select how many rows a page shows. Click **Next** and **Previous** to move. |

**Fixture** on a row makes test data from that row. It includes the rows that the row links to, as SQL or JSON.

### 5.4 Query console

Use it when you know a little SQL. The console only reads. It never changes data, whatever you type.

![Query console](images/16-query.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | SQL editor | Type your query. The editor suggests table and column names. |
| 2 | **Run (read-only)** | Run the query. **Sample** writes an example query for you. |
| 3 | Result | The rows that the query found. **Row cap** limits how many rows show. |
| 4 | **Export CSV** / **Export JSON** | Download all the rows of the result. |
| 5 | **Saved** / **History** / **Running** | Saved queries, queries you ran before, and queries that run now. |
| 6 | Save as | Type a name and click **Save** to keep the query. Click a saved query to run it again. |

### 5.5 MongoDB documents

A MongoDB database has collections and documents, not tables and rows.

![Document browser](images/17-documents.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | Collection | Click a collection to list its documents. |
| 2 | Documents | Click a document to see its fields. |
| 3 | Fields | The fields of the document. Click a field with more fields inside to open it. |
| 4 | Filter | Show only the documents that match. |

## 6. Change the data

You can change data only in a **Sandbox** database. Testate saves a stash first, so you can always undo.

### 6.1 Change rows by hand

1. Open a table.
2. Turn on **Write mode**.

![Write mode](images/14-write-mode.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | Write mode message | Your changes go to the live database. Testate stashes the table before your first change. |
| 2 | **Insert row** | Add a new row. |
| 3 | **Edit** | Change this row. |
| 4 | **⋯** menu | Holds **Delete row**. Testate deletes the row at once, without a question. |
| 5 | **End write mode** | Click it when you finish. |

**Foreign-key checks on** makes sure that a row links only to rows that exist. Turn it off only when you need a broken link for a test.

To add a row:

![Insert a row](images/15-insert-row.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | Value type | **Value** uses what you type. **NULL** leaves it empty. **Default** lets the database fill it. **Function** makes a value, for example the current time. |
| 2 | Value | Type the value. |
| 3 | **Copies** | Add the same row more than once, up to 50. |
| 4 | **Insert** | Save the row. **Insert and add another** saves it and opens an empty form. |

Use **Default** for an ID column. The database gives the next number.

### 6.2 Import a CSV or Excel file

1. Open the database.
2. Click **Import** on the table.
3. Follow the steps below.

![Import a file](images/18-import.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | **File** | Choose a `.csv` or `.xlsx` file. Not sure of the layout? Click **Sample CSV** or **Sample XLSX**. |
| 2 | **What happens** | **Add these rows**: add every row as new. **Add new rows, update existing ones**: update rows with the same key. **Clear the table, then load this file**: delete all rows first. |
| 3 | **Reuse a saved normalizer** | A normalizer is a saved column match. Select one to use it again. Type a name in **Save this as** to keep this one. |
| 4 | Preview | The first rows of your file. Click **columns matched by name** to change which file column goes into which table column. |
| 5 | **Check the file** | Testate checks every row and changes nothing. |
| 6 | Check result | Example: "All 3 rows look ready to import." |
| 7 | **Import** | Load the rows. Testate enables it only after a clean check. |

When the import ends, Testate shows the result.

![Import finished](images/19-import-done.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | Result | How many rows Testate imported. |

The check cannot see every problem. Some rules, for example a duplicate value in a unique column, show only in the real import. To see a report, open **Activity**, then **Imports**, then **Report**. If rows failed, click **Rejected rows** to download them. Fix the file, then click **Re-import rejected**.

## 7. Compare two points in time

Use it to find what your test changed.

1. Open the **States** tab.
2. Click **Compare**.

![Compare window](images/20-compare.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | **From** | Select the older state. |
| 2 | **To** | Select a newer state, or **the live databases** for the data now. |
| 3 | **Compare** | Click it. Testate does the work in the background. |

Open **Activity**, then **Diffs**.

![Diff list](images/21-diffs.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | **Diffs** | The list of comparisons. |
| 2 | Compare | What Testate compared. |
| 3 | **Status** | Wait for **Ready**. **Expires** shows when Testate deletes the comparison. |
| 4 | **Details** | Open the result. |

![Diff details](images/22-diff.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | Changed table | Each table with changes. `+4` means four rows added. `-2` means two removed. `~1` means one changed. |
| 2 | **All** / **Added** / **Removed** / **Changed** | Show only one kind of change. |
| 3 | Row | A `+` row is new. A `-` row is gone. A changed row shows twice: the old row (`-`) and the new row (`+`). A tinted cell changed. Click a cell to read the full value. |

## 8. Files

Some projects connect a file store, for example S3, SFTP, or FTP. Click **Storage** in the side menu.

![Storage list](images/26-storage.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | File store | Click it to open its files. |

![Files](images/27-files.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | Path | Where you are. Click a part of the path to go back up. |
| 2 | File | Click it to see a preview. Click a folder to open it. |
| 3 | **Download** | Save the file on your computer. |
| 4 | **Upload** | Put a file into this folder. **New folder** makes a folder. You can do this only in a Sandbox file store. |

A file store never goes into a state. A checkout does not change your files.

## 9. Jobs and tools

### 9.1 Jobs

Snapshots, checkouts, comparisons, and imports run in the background. Click **Jobs** in the side menu to see them.

![Jobs](images/28-jobs.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | **Kind** | The type of work, for example **Checkout** or **Snapshot**. |
| 2 | **Status** | **Succeeded**, **Running**, or **Failed**. |
| 3 | **Progress** | How far the work is. The **Error** column tells you why a job failed. |
| 4 | **Refresh** | Load the list again. Running jobs update by themselves. |

### 9.2 Tools

**Tools** in the side menu gives three small helpers. **Hash** makes a hash of a value, for example a bcrypt password for a test user. **Random bytes** makes a random value. **UUID v7** makes new IDs. Testate saves nothing that you type here.

## 10. Set up a new project

Ask a developer for the connection details of the test database first: host, port, database name, user, and password.

### 10.1 Make the project

1. Click **Projects** in the side menu.
2. Click **New project**.

![New project](images/06-new-project.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | **Name** | Type the name of the system under test. |
| 2 | **Description** | Optional. Write what the project is for. |
| 3 | **URL** | Testate makes it from the name. |
| 4 | **Create** | Click it. |

### 10.2 Add a database

1. Open the project.
2. Open the **Databases** tab.
3. Click **New adapter**.
4. Paste a **Connection URL**, or fill in each field.
5. Set **Mode** to **Sandbox**, or to **Read-only** for a database that nobody must change.
6. Click **Test connection** and read the result.
7. Click **Create**.

Testate saves the starting point of the new database. This can take some time for a large database.

> **Note:** **New adapter** shows only when the project is on its starting point. If you see the message from [section 5.1](#51-the-databases-of-a-project), click **Check out the starting point** first.

## 11. When something goes wrong

| You see | It means | Do this |
| --- | --- | --- |
| HEAD says **modified** | The live data changed after the last snapshot or checkout. | Nothing, if you expected it. Check out a state to reset. |
| HEAD says **unknown** | A checkout stopped before all databases finished. | Open **Activity**, then **Checkouts**. Click **Retry**. |
| The checkout window shows a schema difference | Someone changed the table layout, for example after a deploy. Testate stops the checkout. | Ask the developer what changed. Turn on **Force past schema drift** only if you accept a partial restore. Testate then restores only the tables and columns that exist on both sides. |
| A checkout fails with a lock timeout | The application holds a lock on a table. Testate shows which sessions block it. | Stop the application, or close the open work. Then click **Retry**. |
| **Counters** failed | New rows can get an ID that already exists. | Click **Counters** on the checkout to repair them. |
| **Write mode** does not show | The database is Read-only, is MongoDB, or the table has no primary key. | Use a Sandbox database with a table that has a primary key. |
| **Import** stays off | The check found rows with problems. | Read the check result. Fix the file. Click **Check the file** again. |
| The quota bar is full | Your states use all the space of the project. | Delete old states that are not protected. |
| A job shows **Failed** | The work did not finish. | Open **Jobs** and read the **Error** column. Show it to your administrator if it is not clear. |
| You cannot sign in | Wrong password five times, or your account is off. | Wait 15 minutes, or ask your administrator. |

## 12. What only an administrator does

A Tester cannot open these screens. Ask your administrator for:

- a new user account or a password reset,
- API tokens for a pipeline or an AI agent,
- the audit log,
- instance settings, such as quota and retention,
- column masking rules.

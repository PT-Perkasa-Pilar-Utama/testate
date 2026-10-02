# Change the data

You can change data only in a **Sandbox** database. Testate saves a stash first, so you can always undo.

## Change rows by hand

1. Open a table.
2. Turn on **Write mode**.

![Write mode](../images/14-write-mode.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | Write mode message | Your changes go to the live database. Testate stashes the table before your first change. |
| 2 | **Insert row** | Add a new row. |
| 3 | **Edit** | Change this row. |
| 4 | **⋯** menu | Holds **Delete row**. Testate deletes the row at once, without a question. |
| 5 | **End write mode** | Click it when you finish. |

**Foreign-key checks on** makes sure that a row links only to rows that exist. Turn it off only when you need a broken link for a test.

To add a row:

![Insert a row](../images/15-insert-row.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | Value type | **Value** uses what you type. **NULL** leaves it empty. **Default** lets the database fill it. **Function** makes a value, for example the current time. |
| 2 | Value | Type the value. |
| 3 | **Copies** | Add the same row more than once, up to 50. |
| 4 | **Insert** | Save the row. **Insert and add another** saves it and opens an empty form. |

Use **Default** for an ID column. The database gives the next number.

## Import a CSV or Excel file

1. Open the database.
2. Click **Import** on the table.
3. Follow the steps below.

![Import a file](../images/18-import.png)

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

![Import finished](../images/19-import-done.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | Result | How many rows Testate imported. |

The check cannot see every problem. Some rules, for example a duplicate value in a unique column, show only in the real import. To see a report, open **Activity**, then **Imports**, then **Report**. If rows failed, click **Rejected rows** to download them. Fix the file, then click **Re-import rejected**.

---

← Previous: [Look at the data](04-look-at-data.md) · [Contents](README.md) · Next: [Compare two points in time](06-compare.md) →

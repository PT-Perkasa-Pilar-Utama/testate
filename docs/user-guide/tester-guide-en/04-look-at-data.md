# Look at the data

## The databases of a project

Open the **Databases** tab.

![Databases tab](../images/11-databases.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | Starting point message | You can add a database only when the project is on its starting point. Click **Check out the starting point** first. |
| 2 | Database name | Click it to open the database. |
| 3 | **Mode** | **Sandbox** lets you change data. **Read-only** lets you only look. |
| 4 | **Status** | **OK** means Testate can connect. |

## One database

![Database screen](../images/12-adapter.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | Table name | Click it to see the rows. |
| 2 | **Import** | Load a CSV or Excel file into this table. See [Import a CSV or Excel file](05-change-data.md#import-a-csv-or-excel-file). |
| 3 | **Query console** | Write a query to read data. |
| 4 | **List** / **Diagram** | **Diagram** shows how the tables link to each other. |
| 5 | **Retest connection** | Check the connection again, for example after a password change. |
| 6 | **Edit adapter** | Change the name, the excluded tables, or the connection details. Ask a developer for the connection details. |

**ROWS (EST.)** is an estimate from the database. Open the table to see the real rows.

## Browse a table

![Table rows](../images/13-grid.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | Filter | Select a column and a condition, type a value, then click **Add filter**. You can add more than one filter. |
| 2 | **Export CSV** / **Export JSON** | Download the rows as a file. |
| 3 | **Write mode** | Turn it on to change rows. See [Change rows by hand](05-change-data.md#change-rows-by-hand). |
| 4 | Column names | Click a column name to sort by it. |
| 5 | Pages | Select how many rows a page shows. Click **Next** and **Previous** to move. |

**Fixture** on a row makes test data from that row. It includes the rows that the row links to, as SQL or JSON.

## Query console

Use it when you know a little SQL. The console only reads. It never changes data, whatever you type.

![Query console](../images/16-query.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | SQL editor | Type your query. The editor suggests table and column names. |
| 2 | **Run (read-only)** | Run the query. **Sample** writes an example query for you. |
| 3 | Result | The rows that the query found. **Row cap** limits how many rows show. |
| 4 | **Export CSV** / **Export JSON** | Download all the rows of the result. |
| 5 | **Saved** / **History** / **Running** | Saved queries, queries you ran before, and queries that run now. |
| 6 | Save as | Type a name and click **Save** to keep the query. Click a saved query to run it again. |

## MongoDB documents

A MongoDB database has collections and documents, not tables and rows.

![Document browser](../images/17-documents.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | Collection | Click a collection to list its documents. |
| 2 | Documents | Click a document to see its fields. |
| 3 | Fields | The fields of the document. Click a field with more fields inside to open it. |
| 4 | Filter | Show only the documents that match. |

---

← Previous: [Look after your states](03-states.md) · [Contents](README.md) · Next: [Change the data](05-change-data.md) →

# Set up a new project

Ask a developer for the connection details of the test database first: host, port, database name, user, and password.

## Make the project

1. Click **Projects** in the side menu.
2. Click **New project**.

![New project](../images/06-new-project.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | **Name** | Type the name of the system under test. |
| 2 | **Description** | Optional. Write what the project is for. |
| 3 | **URL** | Testate makes it from the name. |
| 4 | **Create** | Click it. |

## Add a database

1. Open the project.
2. Open the **Databases** tab.
3. Click **New adapter**.
4. Paste a **Connection URL**, or fill in each field.
5. Set **Mode** to **Sandbox**, or to **Read-only** for a database that nobody must change.
6. Click **Test connection** and read the result.
7. Click **Create**.

Testate saves the starting point of the new database. This can take some time for a large database.

> **Note:** **New adapter** shows only when the project is on its starting point. If you see the message from [The databases of a project](04-look-at-data.md#the-databases-of-a-project), click **Check out the starting point** first.

---

← Previous: [Files, jobs and tools](07-files-jobs-tools.md) · [Contents](README.md) · Next: [Problems and help](09-troubleshooting.md) →

# Files, jobs and tools

## Files

Some projects connect a file store, for example S3, SFTP, or FTP. Click **Storage** in the side menu.

![Storage list](../images/26-storage.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | File store | Click it to open its files. |

![Files](../images/27-files.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | Path | Where you are. Click a part of the path to go back up. |
| 2 | File | Click it to see a preview. Click a folder to open it. |
| 3 | **Download** | Save the file on your computer. |
| 4 | **Upload** | Put a file into this folder. **New folder** makes a folder. You can do this only in a Sandbox file store. |

A file store never goes into a state. A checkout does not change your files.

## Monitor

Testate reads the servers behind a project every 30 seconds: the database server, and the machines that hold the files and the app. It draws what it reads as graphs. Use them when a test fails and you want to know if the machine was the cause, for example a full disk, a busy CPU, or an app that restarted.

Open a project and click the **Monitor** tab.

<!-- 30-monitor.png comes from the browser demo: the dev stack's SFTP server has no host files to graph. scripts/guide-screens.ts does not make it. -->
![Monitor](../images/30-monitor.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | **Monitor** | The graphs of this project's servers. |
| 2 | Time window | Pick how far back to look: 15 minutes to 7 days. |
| 3 | **Sample now** | Read the servers once more, now. Testate also reads them by itself. |
| 4 | Graph | Point at it to see the value at that time. |

A graph has a gap where Testate could not read the server. The line under a server's name says what it could not read, and why. **Monitor** in the side menu lists every server in all your projects, with the newest values.

## Jobs and tools

### Jobs

Snapshots, checkouts, comparisons, and imports run in the background. Click **Jobs** in the side menu to see them.

![Jobs](../images/28-jobs.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | **Kind** | The type of work, for example **Checkout** or **Snapshot**. |
| 2 | **Status** | **Succeeded**, **Running**, or **Failed**. |
| 3 | **Progress** | How far the work is. The **Error** column tells you why a job failed. |
| 4 | **Refresh** | Load the list again. Running jobs update by themselves. |

### Tools

**Tools** in the side menu gives three small helpers. **Hash** makes a hash of a value, for example a bcrypt password for a test user. **Random bytes** makes a random value. **UUID v7** makes new IDs. Testate saves nothing that you type here.

---

← Previous: [Compare two points in time](06-compare.md) · [Contents](README.md) · Next: [Set up a new project](08-new-project.md) →

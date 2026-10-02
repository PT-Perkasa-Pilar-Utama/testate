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

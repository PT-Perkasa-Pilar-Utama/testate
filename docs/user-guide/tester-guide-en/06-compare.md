# Compare two points in time

Use it to find what your test changed.

1. Open the **States** tab.
2. Click **Compare**.

![Compare window](../images/20-compare.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | **From** | Select the older state. |
| 2 | **To** | Select a newer state, or **the live databases** for the data now. |
| 3 | **Compare** | Click it. Testate does the work in the background. |

Open **Activity**, then **Diffs**.

![Diff list](../images/21-diffs.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | **Diffs** | The list of comparisons. |
| 2 | Compare | What Testate compared. |
| 3 | **Status** | Wait for **Ready**. **Expires** shows when Testate deletes the comparison. |
| 4 | **Details** | Open the result. |

![Diff details](../images/22-diff.png)

| No. | What it is | What you do |
| --- | --- | --- |
| 1 | Changed table | Each table with changes. `+4` means four rows added. `-2` means two removed. `~1` means one changed. |
| 2 | **All** / **Added** / **Removed** / **Changed** | Show only one kind of change. |
| 3 | Row | A `+` row is new. A `-` row is gone. A changed row shows twice: the old row (`-`) and the new row (`+`). A tinted cell changed. Click a cell to read the full value. |

---

← Previous: [Change the data](05-change-data.md) · [Contents](README.md) · Next: [Files, jobs and tools](07-files-jobs-tools.md) →

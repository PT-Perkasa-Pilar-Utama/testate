# Problems and help

## When something goes wrong

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

## What only an administrator does

A Tester cannot open these screens. Ask your administrator for:

- a new user account or a password reset,
- API tokens for a pipeline or an AI agent,
- the audit log,
- instance settings, such as quota and retention,
- column masking rules.

---

← Previous: [Set up a new project](08-new-project.md) · [Contents](README.md)

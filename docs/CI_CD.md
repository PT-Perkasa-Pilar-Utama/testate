# Testate in a CI/CD pipeline

The full REST API is available for automation; nothing here is dashboard-only. The endpoint matrix (every resource, its operations, and their status) lives in [docs/api-specs/_index.md](docs/api-specs/_index.md), with one detail document per resource alongside it.

**Browse the API in the running instance.** Every endpoint, its parameters and its responses, with a request you can send from the page:

| Address                | What it serves                                           |
| ---------------------- | -------------------------------------------------------- |
| `/api/v1/docs`         | the reference, rendered by [Scalar](https://scalar.com)  |
| `/api/v1/openapi.json` | the same contract as OpenAPI 3.1, for a client generator |

Open <http://localhost:7378/api/v1/docs> after the quick start above. It is generated from the routes rather than written by hand, so it describes the version you are running.

Both ask who is reading. Any signed-in role may read them, because knowing the API is not a privilege here; an agent token may not, for the same reason it reaches nothing but `/mcp`. A browser with no session is sent to the sign-in screen and comes back afterwards; a client asking for JSON gets a `401`. They touch no data, but they do describe every route on a box a stranger can reach, and that is worth a session.

Health is not behind this: `/api/v1/health/live` and `/api/v1/health/ready` answer with no credential, because a liveness probe has none to give.

**Authentication.** Create a token under **Tokens** (or `POST /api/v1/tokens`, admin only) with kind `standard` and a role. `qa` can run checkouts, imports, and snapshots; `viewer` can only read. Send it as `Authorization: Bearer tst_<token>`. There is no cookie and no CSRF header to add; those apply to the dashboard's own session only.

**Example: reset the database before a test run.** `POST /projects/{slug}/checkouts` restores a named state. Story 113 in the product's own backlog calls this out as the CI entry point. `wait` blocks the request until the job finishes or the given number of seconds pass (1 to 300), but a `202` (still running) is still a successful HTTP call, and a finished job can still have `status: "failed"`. Gate the pipeline step on the job's `status`, not on the HTTP code:

```sh
JOB=$(curl -sf -X POST "$TESTATE_URL/api/v1/projects/shop/checkouts" \
  -H "Authorization: Bearer $TESTATE_TOKEN" -H "Content-Type: application/json" \
  -d '{"state_name": "seeded-baseline"}')
JOB_ID=$(echo "$JOB" | jq -r '.data.job.id')
STATUS=$(echo "$JOB" | jq -r '.data.job.status')

while [ "$STATUS" != "succeeded" ] && [ "$STATUS" != "failed" ] && [ "$STATUS" != "partial" ] \
      && [ "$STATUS" != "cancelled" ] && [ "$STATUS" != "interrupted" ]; do
  sleep 3
  STATUS=$(curl -sf "$TESTATE_URL/api/v1/jobs/$JOB_ID?wait=30" \
    -H "Authorization: Bearer $TESTATE_TOKEN" | jq -r '.data.status')
done

[ "$STATUS" = "succeeded" ] || { echo "checkout ended in status: $STATUS" >&2; exit 1; }
```

Every job-creating `POST` also accepts an `Idempotency-Key` header, so a retried CI step after a network blip does not trigger a second restore.

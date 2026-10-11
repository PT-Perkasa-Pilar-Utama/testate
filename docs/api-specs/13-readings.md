# 13. Resource readings

Module: `readings` ([../technical-specs/26-resource-readings.md](../technical-specs/26-resource-readings.md)). Paths under `/projects/{slug}/readings`, scoped like every project route. A reading is a point in time, not a series.

## 13.1 `POST /projects/{slug}/readings`

**Purpose.** Take a resource reading of the project. **Access.** `qa`. **Input.** No body. **Behavior.** Reads every database adapter's server counters and every SFTP host's load, memory, uptime and disk, in parallel, each adapter under a 15 s timeout (26 §26.1). A value that cannot be read is listed under `unavailable` with the reason, such as the grant that opens it; an adapter that cannot be reached at all answers one `unavailable` entry with the key `adapter`. The reading saves either way. **Output.** `201 { "data": { "id": "...", "taken_at": "...", "actor": { "kind": "user", "label": "tina" }, "adapters": [ { "adapter_id": "...", "name": "orders-db", "engine": "postgres", "source": "server", "values": [ { "key": "connections", "value": 9, "unit": "count" } ], "unavailable": [ { "key": "active_connections", "reason": "needs the pg_read_all_stats role to see other sessions' state" } ] } ] } }`. `source` is `host` or `server`; `unit` is `count`, `bytes`, `seconds`, `ratio` or `load`. **Errors.** `NOT_FOUND` (project). **Traceability.** Story 165.

## 13.2 `GET /projects/{slug}/readings`

**Purpose.** The project's readings, newest first. **Access.** `viewer`. **Input.** Query: `limit` (default 20, max 100), `cursor`. **Output.** `200` page of reading objects as in 13.1. **Errors.** `NOT_FOUND` (project), `VALIDATION_ERROR` (a cursor this server did not give out). **Traceability.** Story 165.

## 13.3 `GET /projects/{slug}/readings/{id}`

**Purpose.** One reading. **Access.** `viewer`. **Output.** `200` reading object as in 13.1. **Errors.** `NOT_FOUND` (project or reading). **Traceability.** Story 165.

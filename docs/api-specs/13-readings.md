# 13. Resource readings

Module: `readings` ([../technical-specs/26-resource-readings.md](../technical-specs/26-resource-readings.md)). Paths under `/projects/{slug}/readings`, scoped like every project route. A reading is one moment; the monitor polls one per project on an interval, and 13.4 draws them as a series.

## 13.1 `POST /projects/{slug}/readings`

**Purpose.** Take a resource reading of the project. **Access.** `qa`. **Input.** No body. **Behavior.** Reads every database adapter's server counters and every SFTP host's CPU, load, memory, uptime, disk, network and pm2 apps, in parallel, each adapter under a 15 s timeout (26 §26.1). A value that cannot be read is listed under `unavailable` with the reason, such as the grant that opens it; an adapter that cannot be reached at all answers one `unavailable` entry with the key `adapter`. The reading saves either way. **Output.** `201 { "data": { "id": "...", "taken_at": "...", "source": "manual", "actor": { "kind": "user", "label": "tina" }, "adapters": [ { "adapter_id": "...", "name": "orders-db", "engine": "postgres", "source": "server", "values": [ { "key": "connections", "value": 9, "unit": "count" } ], "unavailable": [ { "key": "active_connections", "reason": "needs the pg_read_all_stats role to see other sessions' state" } ] } ] } }`. The reading's `source` is `manual` here and `poll` for the monitor's, whose `actor` is `{ "kind": "system", "label": "Testate" }`. An adapter's `source` is `host` or `server`; `unit` is `count`, `bytes`, `seconds`, `ratio`, `load`, `percent` or `bytes_per_second`. **Errors.** `NOT_FOUND` (project). **Traceability.** Story 165.

## 13.2 `GET /projects/{slug}/readings`

**Purpose.** The project's readings, polled and manual, newest first. **Access.** `viewer`. **Input.** Query: `limit` (default 20, max 100), `cursor`. **Output.** `200` page of reading objects as in 13.1. **Errors.** `NOT_FOUND` (project), `VALIDATION_ERROR` (a cursor this server did not give out). **Traceability.** Story 165.

## 13.3 `GET /projects/{slug}/readings/{id}`

**Purpose.** One reading. **Access.** `viewer`. **Output.** `200` reading object as in 13.1. **Errors.** `NOT_FOUND` (project or reading). **Traceability.** Story 165.

## 13.4 `GET /projects/{slug}/readings/series`

**Purpose.** Every value over a window, bucketed, for the monitor's graphs. **Access.** `viewer`. **Input.** Query: `from` and `to` (ISO timestamps; `to` defaults to now, `from` to an hour before `to`), `step` (seconds, 1 to 86400; defaults to about 300 points). **Behavior.** Groups every reading taken from `from` to `to`, both included, by adapter, key and step. **Output.** `200 { "data": { "from": "...", "to": "...", "step_seconds": 60, "lines": [ { "adapter_id": "...", "name": "app-host", "source": "host", "key": "cpu_percent", "unit": "percent", "points": [ { "t": "...", "min": 21.5, "avg": 30.2, "max": 44 } ] } ] } }`. `t` is the start of the step. A step with no sample has no point. **Errors.** `NOT_FOUND` (project), `VALIDATION_ERROR` (`from` not before `to`, or more than 1000 steps). **Traceability.** Story 166.

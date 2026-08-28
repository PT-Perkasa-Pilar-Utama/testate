# 11. Storage Browsing

Module: `storage` ([../technical-specs/05-module-definitions.md §5.11](../technical-specs/05-module-definitions.md)). Drivers: [10 §10.3](../technical-specs/10-integration-points.md). Paths under `/projects/{slug}/adapters/{id}` for adapters of kind `storage`; a database adapter answers `422 ENGINE_UNSUPPORTED { "reason": "tier" }`.

## 11.1 `GET .../entries`

**Purpose.** List a directory (story 94). **Access.** `viewer`. **Input.** Query: `path` (default the adapter's root or prefix), `cursor`, `limit` (default 200, max 1 000), `q` (name contains, within the directory). **Behavior.** Address check; host-key check for SFTP (`CONFLICT { "reason": "host_key_changed", "details": { "fingerprint" } }` when it changed, story 97). **Output.** `200 { "data": [ { "name": "export-2026-08-28.csv", "path": "exports/export-2026-08-28.csv", "kind": "file", "size_bytes": 12345, "modified_at": "..." } ], "page": {...} }`. **Errors.** `NOT_FOUND` (path), `CONFLICT`, `HOST_BLOCKED`, `ADAPTER_UNREACHABLE`. **Traceability.** Stories 94, 97.

## 11.2 `GET .../entries/stat`

**Purpose.** One entry's metadata. **Access.** `viewer`. **Input.** Query: `path` required. **Output.** `200` entry. **Errors.** As 11.1.

## 11.3 `GET .../entries/preview`

**Purpose.** Render text, JSON, CSV (first 200 rows), images, and PDF up to 5 MB (story 95). **Access.** `viewer`. **Input.** Query: `path` required. **Output.** `200 { "data": { "kind": "csv", "columns": [...], "rows": [...], "truncated": true } }` for text and CSV; for images and PDF the raw bytes with `Content-Disposition: inline` and a sandboxed content type. **Errors.** `PAYLOAD_TOO_LARGE` (over the cap), `VALIDATION_ERROR` (unsupported type), as 11.1. **Traceability.** Story 95.

## 11.4 `GET .../entries/download`

**Purpose.** Stream a file (story 96). **Access.** `viewer`. **Input.** Query: `path` required. **Output.** `200` stream, `Content-Disposition: attachment`. **Errors.** As 11.1. **Traceability.** Story 96.

## 11.5 `POST .../host-key/accept`

**Purpose.** Accept a new SFTP host key after a change (story 97). **Access.** `qa`. **Input.** Body: `fingerprint` required (the one reported in the `CONFLICT`). **Behavior.** Replace the row in `known_host_keys`; audit `host_key.accepted`. **Output.** `204`. **Errors.** `VALIDATION_ERROR` (fingerprint does not match the server's current key), `NOT_FOUND`. **Traceability.** Story 97.

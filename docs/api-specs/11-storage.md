# 11. Storage Browsing

Module: `storage` ([../technical-specs/05-module-definitions.md §5.11](../technical-specs/05-module-definitions.md)). Drivers: [10 §10.3](../technical-specs/10-integration-points.md). Paths under `/projects/{slug}/adapters/{id}` for adapters of kind `storage`; a database adapter answers `422 ENGINE_UNSUPPORTED { "reason": "tier" }`. Reading is `viewer`; writing is `qa` on an adapter an admin put in `sandbox` mode.

## 11.1 `GET .../entries`

**Purpose.** List a directory (story 94). **Access.** `viewer`. **Input.** Query: `path` (default the adapter's root or prefix), `cursor`, `limit` (default 200, max 1 000), `q` (name contains, within the directory). **Behavior.** Address check; host-key check for SFTP (`CONFLICT { "reason": "host_key_changed", "details": { "fingerprint" } }` when it changed, story 97). **Output.** `200 { "data": [ { "name": "export-2026-08-28.csv", "path": "exports/export-2026-08-28.csv", "kind": "file", "size_bytes": 12345, "modified_at": "..." } ], "page": {...} }`. **Errors.** `NOT_FOUND` (path), `CONFLICT`, `HOST_BLOCKED`, `ADAPTER_UNREACHABLE`, worded from where the store is and what the socket said ("minio:9000 refused the connection", "files.internal:22 does not resolve", "ftp.local:21 did not answer in time"), with `details.code` from the driver and `details.where`. **Traceability.** Stories 94, 97.

## 11.2 `GET .../entries/stat`

**Purpose.** One entry's metadata. **Access.** `viewer`. **Input.** Query: `path` required. **Output.** `200` entry. **Errors.** As 11.1.

## 11.3 `GET .../entries/preview`

**Purpose.** Render text, JSON, CSV (first 200 rows), images, and PDF up to 5 MB (story 95). **Access.** `viewer`. **Input.** Query: `path` required. **Output.** `200 { "data": { "kind": "csv", "columns": [...], "rows": [...], "truncated": true } }` for text, JSON, and CSV; for images and PDF the raw bytes with `Content-Disposition: inline` and a sandboxed content type. **Errors.** `PAYLOAD_TOO_LARGE` (over the cap), `VALIDATION_ERROR` (unsupported type), as 11.1. **Traceability.** Story 95.

## 11.4 `GET .../entries/download`

**Purpose.** Stream a file (story 96). **Access.** `viewer`. **Input.** Query: `path` required. **Output.** `200` stream, `Content-Disposition: attachment`. **Errors.** As 11.1. **Traceability.** Story 96.

## 11.5 `POST .../entries`

**Purpose.** Write a file to a storage adapter. **Access.** `qa`, and the adapter must be in `sandbox` mode. **Input.** Query: `path` required (where the file lands; the uploaded file's own name is not consulted). Body: `multipart/form-data` with one `file` field. **Behavior.** Directories above the path are made; whatever is at the path is overwritten; audit `file.uploaded` with the path as the target label. **Output.** `201` entry. **Errors.** `ADAPTER_READ_ONLY` (the adapter is not a sandbox), `PAYLOAD_TOO_LARGE` (over `TESTATE_MAX_UPLOAD_MB`), `VALIDATION_ERROR` (no file, or a path that names the root), as 11.1.

## 11.6 `DELETE .../entries`

**Purpose.** Delete one file. **Access.** `qa`, and the adapter must be in `sandbox` mode. **Input.** Query: `path` required. **Behavior.** Files only; a directory is refused rather than emptied, because recursive delete means something different on each of the three protocols. Audit `file.deleted`. Testate keeps no copy. **Output.** `204`. **Errors.** `ADAPTER_READ_ONLY`, `VALIDATION_ERROR` (the path is a directory), `NOT_FOUND`, as 11.1.

## 11.7 `PATCH .../entries`

**Purpose.** Rename a file, which is also how it moves to another folder. **Access.** `qa`, and the adapter must be in `sandbox` mode. **Input.** Body: `path` and `to`, both whole paths. **Behavior.** S3 copies the key inside the store and drops the old one; SFTP and FTP use their own rename. Folders above `to` are made. A directory is refused for the same reason 11.6 refuses one, and a `to` that already holds something is refused rather than overwritten: the caller cannot see what is there, and a rename that lands on a file destroys it with nothing to undo it from. Audit `file.renamed` with `to` in the details. **Output.** `200` entry, at its new path. **Errors.** `ADAPTER_READ_ONLY`, `CONFLICT` (something is already at `to`), `VALIDATION_ERROR` (either path is a directory or names the root), `NOT_FOUND`, as 11.1.

## 11.8 `POST .../entries/copy`

**Purpose.** Copy a file to a free path on the same store. **Access.** `qa`, and the adapter must be in `sandbox` mode. **Input.** Body: `path` and `to`, both whole paths. **Behavior.** The bytes are read through Testate and written at `to`; folders above `to` are made. A directory is refused, and so is a `to` that already holds something. Audit `file.copied` with `to` and `bytes` in the details. **Output.** `201` entry, at the new path. **Errors.** `ADAPTER_READ_ONLY`, `CONFLICT` (something is already at `to`), `VALIDATION_ERROR` (either path is a directory or names the root), `NOT_FOUND`, as 11.1.

## 11.9 `POST .../entries/directory`

**Purpose.** Make an empty folder. **Access.** `qa`, and the adapter must be in `sandbox` mode. **Input.** Body: `path` required. **Behavior.** Uploading already makes the folders above the file it writes, so this is only for the folder made before the file exists. SFTP and FTP make a real directory. S3 has none, and the usual `folder/` marker cannot be written through Bun's client, which drops the trailing slash: it writes a zero-byte `.keep` object inside the folder instead, which every S3 tool reads as a folder. The listing hides that object; `stat` and 11.9 ask for it. Audit `folder.created`. **Output.** `201` entry, `kind: "directory"`. **Errors.** `ADAPTER_READ_ONLY`, `CONFLICT` (something is already there), `VALIDATION_ERROR` (the path names the root), as 11.1.

## 11.10 `DELETE .../entries/directory`

**Purpose.** Remove a folder with nothing in it. **Access.** `qa`, and the adapter must be in `sandbox` mode. **Input.** Query: `path` required. **Behavior.** A folder that still holds anything is refused; emptying it is the caller's to do, one file at a time, for the same reason 11.6 refuses a recursive delete. Audit `folder.deleted`. **Output.** `204`. **Errors.** `ADAPTER_READ_ONLY`, `CONFLICT` (the folder is not empty), `NOT_FOUND`, as 11.1.

## 11.11 `POST .../host-key/accept`

**Purpose.** Accept a new SFTP host key after a change (story 97). **Access.** `qa`. **Input.** Body: `fingerprint` required (the one reported in the `CONFLICT`). **Behavior.** Replace the row in `known_host_keys`; audit `host_key.accepted`. **Output.** `204`. **Errors.** `VALIDATION_ERROR` (the adapter is not SFTP, or the fingerprint does not match the server's current key), `NOT_FOUND`. **Traceability.** Story 97.

# 17. Tools

Module: `tools` ([../technical-specs/05-module-definitions.md §5.18](../technical-specs/05-module-definitions.md)). Stateless; nothing is stored; inputs never enter the wide event; rate-limited per actor. Any role.

## 17.1 `POST /tools/hash`

**Purpose.** Produce a hash the way a form function or an import transform would (story 131).

**Input.** Body:

| field | type | required | notes |
| --- | --- | --- | --- |
| `algorithm` | `argon2id` \| `bcrypt` \| `sha256` \| `sha512` \| `hmac_sha256` | yes | |
| `value` | string | yes | up to 4 096 characters |
| `secret` | string | hmac | the HMAC key; never stored |
| `salt` | string | no | sha256 and sha512 only: prepended; argon2id and bcrypt generate their own |
| `cost` | integer | no | bcrypt 4 to 14 (default 12); argon2id memory 16 to 128 MiB via `memory_mib` (default 64) |

**Output.** `200 { "data": { "algorithm": "bcrypt", "hash": "$2b$12$..." } }`. **Errors.** `VALIDATION_ERROR`, `RATE_LIMITED`. **Traceability.** Story 131.

## 17.2 `POST /tools/random`

**Purpose.** A random secret (story 132). **Input.** Body: `bytes` integer 8 to 1 024 (default 32); `encoding` `hex` | `base64` | `base64url` (default `base64url`). **Output.** `200 { "data": { "value": "..." , "bytes": 32, "encoding": "base64url" } }`. **Traceability.** Story 132.

## 17.3 `POST /tools/uuid`

**Purpose.** UUIDs (story 133). **Input.** Body: `version` 4 | 7 (default 7); `count` 1 to 100 (default 1). **Output.** `200 { "data": { "values": ["01J..."] } }`. **Traceability.** Story 133.

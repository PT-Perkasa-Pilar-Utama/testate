# 7. Security

Testate holds credentials to databases and can empty them. Every control below exists because of that.

## 7.1 Threat surface

| Surface | Threat | Control |
| --- | --- | --- |
| Dashboard and API | Credential stuffing, session theft, CSRF | Lockout, argon2id, opaque sessions, same-site cookies plus header check, HTTPS behind nginx |
| API tokens | Leaked CI token | Role cap, project scope (which also bars instance administration, so the scope cannot be widened from inside it), expiry, revoke, hashed at rest, rate budget |
| Stored credentials | Volume or backup theft | Sealed values (AES-256-GCM), key outside the volume, rotation |
| Outbound connections | SSRF into the intranet, metadata endpoints, Testate itself | Resolve-and-check on every physical connection, fixed denies, admin deny list |
| Destructive operations | Wrong target, wrong click | Adapter mode, admin-only loosening, stash, protection, typed-slug delete, return to init, audit |
| Uploads | Oversized or hostile files | Size limit, streaming parse, per-run directory, deletion after the job |
| Logs | Secrets in logs | Structural redaction in the wide event; no query text, rows, or credentials |
| Container | Escape or tampering | Non-root, read-only root filesystem, one writable mount |

## 7.2 Authentication and authorization

| Concern | Implementation |
| --- | --- |
| Dashboard login | `POST /auth/login`; argon2id verify; lockout after five failures for fifteen minutes per username, plus a per-address cap on failed attempts (§7.5); audit row per attempt, and the address cap adds a field to the request's wide event rather than an audit row an attacker could use to fill the disk |
| Session | 256-bit random value, SHA-256 in `sessions`; cookie `testate_session`, `HttpOnly`, `SameSite=Strict`, `Secure` when the request arrived over HTTPS (trust proxy) , `Path` = base path; idle 12 h, absolute 7 d; touched at most once per minute |
| Forced change | `must_change_password` gates every route except `auth.changePassword`, `auth.logout`, `auth.me`, and `health` |
| Bearer tokens | `Authorization: Bearer tst_<base64url 32 bytes>`; SHA-256 lookup, constant-time compare; role from the token; project scope enforced by middleware on every `/projects/:slug` route and every list |
| Roles | Cumulative lattice `admin ⊇ qa ⊇ viewer`; `requireRole(min)` on each router; per-action checks in services for admin-only transitions (loosen mode, delete project, tokens, users, settings) |
| Cookie CSRF | Mutating requests with a cookie session must carry `X-Testate-Request: 1`; browsers cannot set it cross-site without CORS approval, and CORS is off. Bearer requests skip the check |

The full role matrix is in [09-authentication.md](09-authentication.md).

## 7.3 Sealed values and keys

| Concern | Implementation |
| --- | --- |
| What is sealed | Every column in the sealed registry ([17-sealed-values.md](17-sealed-values.md) §17.4): adapter secrets, read-only credentials, S3 store keys |
| Cipher | AES-256-GCM through WebCrypto, 96-bit random nonce per record, envelope `v1.<kid>.<nonce>.<ciphertext+tag>` base64url |
| Keys | `TESTATE_SECRETS_ACTIVE_KEY`: one to five base64 32-byte keys, comma separated, first seals; refusal to boot when missing, malformed, duplicated, or unable to open stored values |
| Rotation | Boot sweep re-seals under the first key; banners; declared-loss flag; procedure in `../KEY_ROTATION.md` |
| Exposure | Never returned by the API, never in audit details, never in wide events, never in archives; UI shows "set", date, key fingerprint |
| Passwords and tokens | Hashed, not sealed; argon2id for passwords, SHA-256 for high-entropy tokens |

## 7.4 Outbound connection policy

Every physical connection Testate opens (database, S3, SFTP, FTP, S3 snapshot store) goes through `lib/netguard.check(host, port)` at connect time, not at save time. The check resolves the host and refuses: loopback and link-local ranges (`127.0.0.0/8`, `::1`, `169.254.0.0/16`, `fe80::/10`), cloud metadata addresses (`169.254.169.254`, `fd00:ec2::254`, `metadata.google.internal`), Testate's own listening address and port, and every entry of the admin deny list (`netguard.deny`, hostname globs and CIDRs). Loopback is on the default deny list and removable by an admin; the rest is fixed. DNS answers are used for the connection that was checked, never re-resolved by the driver; when a driver resolves on its own (MongoDB SRV), Testate resolves first and passes addresses. Details in [18-outbound-address-policy.md](18-outbound-address-policy.md).

## 7.5 Request hardening

| Concern | Implementation |
| --- | --- |
| Body limits | JSON bodies 1 MiB, `/mcp` 2 MiB (an agent's file rides inside its arguments), multipart uploads `TESTATE_MAX_UPLOAD_MB` (default 50) plus one for the boundary; `bodyLimits` in `lib/http/hardening.ts` answers `413 PAYLOAD_TOO_LARGE` before the body is read, and nginx `client_max_body_size` in front |
| Validation | valibot on every body, query, param; unknown keys rejected; strings trimmed and length-capped |
| Rate limits | Login: five failures lock the username for fifteen minutes, and `limits.failed_logins_per_minute` caps failed attempts per client address so one caller cannot spray a password across many usernames, nor lock a real person out by guessing at their name; a login that succeeds spends no budget. Token requests: `limits.token_requests_per_minute` per token. All answer `429 RATE_LIMITED` with `Retry-After` |
| Headers | `securityHeaders` in `lib/http/hardening.ts` on every response: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `Permissions-Policy` denying camera, microphone, geolocation, payment and USB; `Strict-Transport-Security` for a year with subdomains when `TESTATE_TRUST_PROXY` is set, the same flag that makes the cookie `Secure`; `Cache-Control: no-store` under the API prefix |
| CSP | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`. The style inline is for the attributes Solid writes; there is no inline script. The API reference (`/docs`) carries its own policy that admits Scalar's bundle from `cdn.jsdelivr.net` and its inline configuration, behind a session. A stored-file preview answers with `sandbox; default-src 'none'` of its own, which the middleware leaves alone, and renders inside `<iframe sandbox>`; `Content-Disposition: inline` only for image and PDF types, `attachment` otherwise |
| CORS | Off. The SPA is same-origin; automation uses tokens from servers |
| CSV | A cell that a spreadsheet would run (`=`, `+`, `@`, tab, return, or `-` not starting a number) leaves a query, table, diff or audit export with a leading apostrophe (`exportCell` in `lib/csv.ts`). The rejected-rows file and the sample CSV stay faithful, because Testate reads them back |
| Errors | Envelope carries `code`, `message`, `details`; stack traces never leave the process; internal errors log the stack under `TESTATE_LOG_STACKS` only |
| Request id | `X-Request-Id` accepted from the proxy when `TESTATE_TRUST_PROXY` is true, else generated; echoed in the response |

## 7.6 Destructive-operation controls

| Operation | Controls |
| --- | --- |
| Checkout | `qa`, `sandbox` adapter, stash first, drift refusal unless force, per-adapter results, audit |
| Write session | `qa`, `sandbox`, stash on first write, idle timeout, audit per session |
| Replace import | `qa`, `sandbox`, stash first, dry run available, audit |
| Loosen read-only | `admin`, own audit action |
| Delete state | `qa`, refused for protected and init |
| Delete adapter | `qa`, deletion plan, return to init first, audit survives |
| Delete project | `admin`, typed slug, deletion plan, return to init first, removal only after every restore succeeded, audit survives |
| Reset-state (Testate itself) | route absent in production; `admin`; refused while jobs run |

## 7.7 Object store and volume access

| Concern | Implementation |
| --- | --- |
| Local store | `${TESTATE_DATA_DIR}/blobs/<aa>/<hash>`; container user owns `/data`; no other path is writable |
| S3 store | Keys sealed in settings or given by environment; bucket and prefix fixed; server-side encryption left to the bucket policy; virtual-hosted or path style per setting |
| Archives and downloads | Streamed with `Content-Disposition: attachment`; file names derived from state names, sanitized |
| Backups | Contain sealed values as sealed; a restore needs the same keys; the backup job records the key fingerprints |

## 7.8 Operational-endpoint policy

`GET /api/v1/health`, `/health/live`, and `/health/ready` are public for liveness. The dependency breakdown appears only for an authenticated admin. `POST /api/v1/admin/reset-state` is mounted only when `TESTATE_ENV` is not `production`; the router registration is inside `if (config.env !== "production")`, so the route does not exist in production and cannot be reached with any credential. This is enforced at route registration, not by authorization, and the API test suite asserts a `404` for the path when the app is built with `TESTATE_ENV=production`.

## 7.9 Container

Non-root user `testate` (uid 1001); read-only root filesystem with `/data` as the only writable mount and `/tmp` as tmpfs; no shell in the runtime image beyond what the base image ships; `bun dist/index.js` as PID 1 with `SIGTERM` handling; healthcheck on `/api/v1/health/live`.

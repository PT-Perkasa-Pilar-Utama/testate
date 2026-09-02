# OWASP checklist

What Testate does against the OWASP lists that apply to it: the API Security Top 10 (2023), the
Web Application Top 10 (2021), and the parts of the Application Security Verification Standard
(ASVS 4.0) that a self-hosted, single-tenant tool with database credentials has to answer. Each
row names where the control lives, so a reader can check the claim rather than trust it. The
last section lists what is deliberately not done, so nobody audits it twice.

Spec [07 Security](technical-specs/07-security.md) is the design; this is the audit view of it.

## API Security Top 10 (2023)

| # | Risk | Status | Where |
| --- | --- | --- | --- |
| API1 | Broken object level authorization | Done | Every project route passes `requireProjectInScope`; a project-scoped token cannot list or touch another project, and cannot administer its way out (`lib/http/auth.ts`, `requireUnscoped`) |
| API2 | Broken authentication | Done | argon2id (64 MiB, 2 passes), 12-character minimum, five failures lock the account for fifteen minutes, per-address failure budget, sessions of 12 idle hours and 7 days, a password change ends every other session, session and token secrets stored as SHA-256 |
| API3 | Broken object property level authorization | Done | Every body, query and param parses with valibot and unknown keys are refused; response schemas are the contract (`packages/shared`); column policies mask values by role and agents have no unmask |
| API4 | Unrestricted resource consumption | Done | JSON bodies 1 MiB, uploads `TESTATE_MAX_UPLOAD_MB`, `413` before the body is read; query row, byte and time budgets; token requests per minute; job concurrency; agent byte budget (`lib/http/hardening.ts`, `settings.limits`) |
| API5 | Broken function level authorization | Done | `requireRole` on every non-public route, cumulative roles, agent tokens reach `/mcp` only, `POST /admin/reset-state` never mounts in production (`e2e/roles` and `api.e2e.ts` pin it) |
| API6 | Unrestricted access to sensitive business flows | Done | Checkout and delete need a confirmation with the plan shown first; protected states refuse deletion; a second job on a busy adapter is refused |
| API7 | Server side request forgery | Done | Every outbound host passes the address policy before a socket opens: loopback, link-local and cloud metadata denied without an off switch, plus an admin deny list re-checked on change (`lib/netguard`) |
| API8 | Security misconfiguration | Done | Security headers and CSP on every response, HSTS behind a TLS proxy, no CORS, generic `INTERNAL` message with stacks only in logs, non-root image with a read-only filesystem, no capabilities and `no-new-privileges` |
| API9 | Improper inventory management | Done | One versioned prefix (`/api/v1`), the OpenAPI document generated from the routes and served behind a session, the version in `/health` |
| API10 | Unsafe consumption of APIs | Done | Rows from engines and objects from stores parse with valibot before use; storage paths are normalised and `..` refused; archives are read by entry name against a manifest |

## Web Application Top 10 (2021)

| # | Risk | Status | Where |
| --- | --- | --- | --- |
| A01 | Broken access control | Done | As API1 and API5; CSRF header on every cookie mutation, `SameSite=Strict` |
| A02 | Cryptographic failures | Done | Sealed values (AES-GCM under `TESTATE_SECRETS_ACTIVE_KEY`, key rotation with two keys), argon2id, secrets never logged; the logger refuses the keys `password`, `token`, `secret`, `connection_string` |
| A03 | Injection | Done | Parameterised queries in every repository; the query console runs inside a read-only transaction by design; CSV exports neutralise spreadsheet formulas; Solid renders text, the one `innerHTML` is the icon table from source |
| A04 | Insecure design | Done | Stash before every write session, import and checkout; init states; protected states; deletion plans shown before they run |
| A05 | Security misconfiguration | Done | As API8; `TESTATE_ENV` is the only gate for development endpoints; boot refuses without a key |
| A06 | Vulnerable and outdated components | Done | Lockfile, Dependabot weekly (bun and actions), `bun audit` clean, actions pinned by hash, CodeQL and Scorecard on every push |
| A07 | Identification and authentication failures | Done | As API2; a forced password change on first login and on reset; account enumeration answers the same for a wrong name, a wrong password and a disabled account |
| A08 | Software and data integrity failures | Done | Signed images and binaries (cosign, keyless), SLSA provenance attestations, SBOM per release, content-addressed snapshot blobs, a backup records its key fingerprints |
| A09 | Security logging and monitoring failures | Done | One wide event per request with actor and outcome, an audit row for every login, user, token, adapter, checkout, import, write session and deletion, audit rows outlive what they describe |
| A10 | Server side request forgery | Done | As API7 |

## ASVS 4.0, the chapters that apply

| Chapter | Status | Note |
| --- | --- | --- |
| V2 Authentication | Done, one gap | 2.1.7 (breached-password lookup) is not done: the instance is offline by design |
| V3 Session management | Done | Cookie `HttpOnly`, `SameSite=Strict`, `Secure` behind TLS, idle and absolute timeouts, logout revokes server-side |
| V4 Access control | Done | Deny by default, roles cumulative, checks server-side only |
| V5 Validation and encoding | Done | valibot at every boundary; output is JSON or text, never templated HTML |
| V6 Cryptography | Done | AES-GCM, random from the platform, keys from the environment only |
| V7 Logging | Done | Structured, redacted, retained by `TESTATE_LOG_RETENTION_DAYS` |
| V8 Data protection | Done | Snapshots are your test data in the clear on the volume; the volume is the boundary and `SECURITY.md` says so |
| V9 Communication | Delegated | TLS terminates at the proxy; HSTS and `Secure` follow `TESTATE_TRUST_PROXY` |
| V12 Files | Done | Size caps, `nosniff`, `attachment` for anything not an image or PDF, sandboxed preview, no path escapes |
| V13 API | Done | JSON only, envelope with stable codes, cursor pagination with limits, CSRF on cookie writes |
| V14 Configuration | Done | Headers above; `/docs` behind a session; the image runs as `bun`, read-only, no capabilities |

## Deliberately not done

- **`style-src 'unsafe-inline'`.** Solid writes style attributes; a nonce cannot cover an attribute.
  There is no inline script anywhere, so `script-src` stays `'self'`.
- **The API reference loads Scalar from jsdelivr** with inline configuration, on a page behind a
  session. Vendoring the bundle would ship a copy of a viewer that changes weekly.
- **No breached-password lookup.** The instance does not call out; the 12-character floor and the
  argon2id cost are the defence.
- **No rate limit on session mutations beyond login.** A session belongs to a person an admin
  created; tokens, which automation holds, are limited per minute.
- **No multi-factor authentication.** Out of scope for a tool that sits inside a network; put it
  on the proxy if the network needs it.
- **Snapshots are stored in the clear.** Encrypting them would protect against a copied volume and
  nothing else, and the databases they came from are in the clear on the same network.

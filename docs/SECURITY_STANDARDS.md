# Security standards

What Testate does against the lists that apply to it: OWASP's API Security Top 10 (2023) and Web
Application Top 10 (2021), the OWASP Application Security Verification Standard (chapters cited
with 4.0.3 numbering; the requirements carry over to 5.0), the IEEE Center for Secure Design's
ten design flaws, and the practices IBM's Secure Engineering Framework asks of a product. Each
row names where the control lives, so a reader can check the claim rather than trust it. The
last two sections say what to do before an instance faces the internet, and what is deliberately
not done, so nobody audits it twice.

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
| V2 Authentication | Done, one gap | 2.1.7 asks for a breached-password lookup; the instance is offline, so it refuses the top of every breach list (`passwordWeakness`, packages/shared) and stops there; the username is not a rule, since the bootstrap account is called `admin` |
| V3 Session management | Done | Cookie `HttpOnly`, `SameSite=Strict`, `Secure` behind TLS and then `__Host-` prefixed on a root-path deploy, idle and absolute timeouts, a new session per login, logout revokes server-side |
| V4 Access control | Done | Deny by default, roles cumulative, checks server-side only |
| V5 Validation and encoding | Done | valibot at every boundary; output is JSON or text, never templated HTML |
| V6 Cryptography | Done | AES-GCM, random from the platform, keys from the environment only |
| V7 Logging | Done | Structured, redacted, retained by `TESTATE_LOG_RETENTION_DAYS` |
| V8 Data protection | Done | Snapshots are your test data in the clear on the volume; the volume is the boundary and `SECURITY.md` says so |
| V9 Communication | Delegated | TLS terminates at the proxy; HSTS and `Secure` follow `TESTATE_TRUST_PROXY` |
| V12 Files | Done | Size caps, `nosniff`, `attachment` for anything not an image or PDF, sandboxed preview, no path escapes |
| V13 API | Done | JSON only, envelope with stable codes, cursor pagination with limits, CSRF on cookie writes |
| V14 Configuration | Done | Headers above; `/docs` behind a session; the image runs as `bun`, read-only, no capabilities |

## IEEE Center for Secure Design: the ten flaws

| Flaw to avoid | Status | Where |
| --- | --- | --- |
| Earn or give, but never assume, trust | Done | Every request re-resolves its credential; a token acts as its role and scope on every call; engines' rows and stores' objects are parsed before use |
| Use an authentication mechanism that cannot be bypassed | Done | `authenticate` runs on every route; `requireRole` on every non-public one; the API reference asks for a session; `/mcp` refuses everything but an agent token |
| Authorize after you authenticate | Done | Role, project scope and agent-ness are checked per route after the actor is known; mode changes are an admin's at the service, not only the button |
| Strictly separate data and control instructions | Done | Parameterised SQL in every repository; the query console runs user SQL inside a read-only transaction and says so; agent tool arguments parse with valibot |
| Define an approach that ensures all data are explicitly validated | Done | valibot at every trust boundary (body, query, params, env, engine rows, MCP arguments), unknown keys refused |
| Use cryptography correctly | Done | AES-GCM sealed values, argon2id, platform randomness, SHA-256 for session and token lookup; keys come from the environment only |
| Identify sensitive data and how they should be handled | Done | Sealed values never leave the API; the logger refuses credential keys; masks apply before an agent or a viewer sees a value; snapshots are named as sensitive in SECURITY.md |
| Always consider the users | Done, by design | A stash before every write, import and checkout; a deletion plan before it runs; forced password change on first login; errors in words |
| Understand how integrating external components changes your attack surface | Done | Lockfile, Dependabot, `bun audit`, actions pinned by hash, CodeQL and Scorecard; engines are reached through an address policy with a deny list |
| Be flexible when considering future changes to objects and actors | Done | Roles are cumulative and named once (`packages/shared`); keys rotate with two in the environment; the API is versioned under one prefix |

## IBM Secure Engineering Framework, the practices

| Practice | Status | Where |
| --- | --- | --- |
| Threat model and attack surface | Done | Spec 07 §7.1 names the surface; SECURITY.md names what the instance holds and where it is exposed |
| Secure by default | Done | New adapters default to read-only for a file store; write sessions need sandbox mode; development endpoints never mount in production; strangers share a per-address request budget |
| Least privilege | Done | Three cumulative roles, project-scoped tokens that cannot administer, agent tokens fenced to `/mcp`, a container that runs as `bun` with no capabilities |
| Secure coding standard and review | Done | `docs/CODING_STANDARD.md`, lint rules for the hazards, `docs/CODE_REVIEW_CHECKLIST.md`, two reviews and a code-owner review on main |
| Static and dependency analysis | Done | CodeQL on every push, Scorecard weekly, Dependabot, `bun audit` in the gate |
| Security testing | Done | Role and scope pinned by `roles.test.ts` and the e2e suite; contract suites against real engines; property tests over the parsers |
| Logging and incident response | Done | One wide event per request, an audit row per security-relevant action, SECURITY.md's reporting path with acknowledgment and fix timelines |
| Vulnerability response and updates | Done | Latest release maintained, advisories on fix, signed images and binaries with provenance so an update can be verified |

## ISO/IEC, and what a product can and cannot claim

ISO/IEC 27001 certifies an organisation's information security management system, not a piece
of software: a repository cannot comply with it. What Testate can do is hand the organisation
that runs it the evidence its Annex A (2022) controls ask for. The standards below that do
address software itself are followed directly.

| Standard | What it is | Status | Where |
| --- | --- | --- | --- |
| ISO/IEC 27001:2022 A.5.15, A.8.2, A.8.3 | Access control, privileged access, information access restriction | Evidence provided | Three cumulative roles, admin-only mode changes and administration, project-scoped tokens, agent tokens fenced to `/mcp`; every grant and revocation in the audit log |
| A.8.5 | Secure authentication | Evidence provided | argon2id, twelve-character floor, common-password list, lockout after five failures, per-address budgets, forced change on first login, sessions bound to a host-locked cookie |
| A.8.8 | Management of technical vulnerabilities | Evidence provided | Dependabot, `bun audit` in the gate, CodeQL on every push, Scorecard weekly, advisories with a fix, SECURITY.md timelines |
| A.8.9 | Configuration management | Evidence provided | One image, one volume, configuration from the environment only and refused when incomplete; `bun run bump-version --check` keeps every version slot in step |
| A.8.12 | Data leakage prevention | Evidence provided | Column policies mask values by role with no unmask for agents; the logger refuses credential keys; sealed values never return |
| A.8.13 | Information backup | Evidence provided | A backup job for metadata and blobs, recording the key fingerprints that sealed its values; restore by replacing the volume |
| A.8.15, A.8.16 | Logging, monitoring | Evidence provided | One wide event per request and job, an audit row per security-relevant action that outlives what it describes, a health endpoint and structured logs for whatever watches the instance |
| A.8.24 | Use of cryptography | Evidence provided | AES-GCM sealed values under an environment key, two-key rotation, argon2id, SHA-256 lookups, keyless-signed releases with provenance |
| A.8.25, A.8.27, A.8.28 | Secure development life cycle, secure architecture, secure coding | Followed | Threat surface in spec 07, the coding standard and its lint rules, two reviews and a code-owner review on main, the review checklist |
| A.8.29 | Security testing in development | Followed | Role and scope pinned by tests, contract suites against real engines, browser suite over every story, property tests over the parsers |
| A.8.31 | Separation of environments | Followed | Development endpoints never mount in production; the suite and the dev server run on separate ports and data directories |
| ISO/IEC 27034 | Application security | Followed in principle | The controls in this document are the application security controls; there is no organisation-level ASC library to register them in, which is the adopter's |
| ISO/IEC 29147 | Vulnerability disclosure | Followed | SECURITY.md names the contact, what to send, and the acknowledgment, assessment and fix timelines; the homepage serves `/.well-known/security.txt` (RFC 9116) |
| ISO/IEC 30111 | Vulnerability handling | Followed | The same timelines, a fix on the latest release with an advisory; no backports, which SECURITY.md says |
| ISO/IEC 25010 | Product quality, the security characteristic | Followed | Confidentiality (sealing, masks), integrity (signed releases, stashes), accountability (audit), authenticity (sessions, tokens), non-repudiation (audit rows with actor and address) |

What an adopter still owns under 27001: the risk assessment that decides whether Testate is
exposed at all, the access reviews of who holds which role, the operating procedures for
rotation and backup, and the incident process the reporting path feeds into.

## Before an instance faces the internet

Testate is built to sit beside a system under test, inside a network. Nothing stops an adopter
from exposing it for convenience, so here is what has to be true first, in order:

1. **TLS terminates in front of it**, and `TESTATE_TRUST_PROXY=true` is set. That one flag turns
   on HSTS, marks the session cookie `Secure` and `__Host-`, and makes rate limits and audit rows
   see the client's address rather than the proxy's.
2. **A strong bootstrap password**, changed on first login, and never the README's example.
3. **A second factor at the door.** Testate has no MFA of its own; put it behind an identity-aware
   proxy (Cloudflare Access, oauth2-proxy, Pomerium) or a VPN. Without one, a public instance's
   admin is one password away.
4. **Tokens with an expiry**, scoped to one project each, and the agent token for exactly one
   agent. Revoke on rotation.
5. **Rotate the sealing key on a schedule** (docs/KEY_ROTATION.md) and keep backups with their
   key fingerprints.
6. **Read the audit log**, or ship the wide events to something that does, so a login from the
   wrong continent is noticed.
7. **Keep the databases it reaches on private addresses.** The deny list blocks loopback and the
   cloud metadata service already; add the ranges your network does not want probed.

## Deliberately not done

- **`style-src 'unsafe-inline'`.** Solid writes style attributes; a nonce cannot cover an attribute.
  There is no inline script anywhere, so `script-src` stays `'self'`.
- **The API reference loads Scalar from jsdelivr** with inline configuration, on a page behind a
  session. Vendoring the bundle would ship a copy of a viewer that changes weekly.
- **No breached-password lookup.** The instance does not call out; the 12-character floor, the
  common-password list and the argon2id cost are the defence.
- **No rate limit on a signed-in session's writes.** A session belongs to a person an admin
  created; tokens, which automation holds, are limited per minute, and strangers share a budget.
- **No multi-factor authentication of its own.** Out of scope for a tool that sits inside a
  network; an instance that faces the internet puts it on the proxy, as the section above says.
- **Snapshots are stored in the clear.** Encrypting them would protect against a copied volume and
  nothing else, and the databases they came from are in the clear on the same network.

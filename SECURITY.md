# Security policy

## Supported versions

The latest release is maintained. Fixes are not backported to earlier versions; upgrade to the
latest image or binary.

## Reporting a vulnerability

**Do not open a public issue for a vulnerability.** Email **awalariansyah7@gmail.com** with what
you found, how to reproduce it, the version affected, and a fix if you have one. You get an
acknowledgment within 72 hours, an assessment within 7 days, and a fix with an advisory within 30
days of confirmation.

## What Testate holds, and where it is exposed

Testate sits beside a system under test with the credentials of every database it snapshots, so
its attack surface is the interesting part of this document.

- **Credentials.** Database passwords, connection strings, S3 keys, SFTP passwords and private
  keys are sealed values: encrypted at rest with `TESTATE_SECRETS_ACTIVE_KEY`, write-only through
  the API, never logged. The logger refuses the keys `password`, `token`, `secret` and
  `connection_string` outright.
- **Outbound connections.** Every host an adapter reaches is checked against an address policy
  before the connection opens. Loopback and link-local ranges are denied by default, so an
  instance cannot be pointed at itself or at the cloud metadata service.
- **The REST API and the dashboard.** Session cookies, a CSRF header on every write, roles that
  are cumulative (`viewer` < `qa` < `admin`), and personal tokens that act as their role.
- **The MCP endpoint.** An agent token reaches `/api/v1/mcp` and nothing else. A Guest agent has
  no write path; a Tester agent writes only to sandbox adapters through a stashed write session.
  Column policies mask values before an agent sees them, with no unmask.
- **The data directory.** SQLite metadata, content-addressed snapshot blobs and logs live under
  `TESTATE_DATA_DIR`. Snapshots hold your test data in the clear; protect that volume the way
  you protect the databases it came from.

The controls behind this, checked against the OWASP lists, are in
[docs/OWASP.md](docs/OWASP.md).

Reports in scope: anything that lets a role do more than the table in the README says, reads a
sealed value back, reaches a denied address, escapes a masked column, or writes through a Guest
agent token.

Out of scope: vulnerabilities in the database engines themselves, issues that require write
access to the host filesystem or the data volume, and findings against a deliberately weakened
configuration (`TESTATE_ENV=development`, an emptied deny list).

## Verifying what you run

Every release is built by this repository's GitHub Actions workflow and leaves a trail you can
check without trusting us:

- **Build provenance** (SLSA) on the container image and on every binary archive, verifiable
  with `gh attestation verify`.
- **Keyless Sigstore signatures** on the image digest and on every archive, verifiable with
  `cosign`.
- **A CycloneDX SBOM** attached to each release.

The exact commands are in the README under "Verify a download". An artifact that lacks a matching
attestation is not ours; report it through the address above.

## Dependencies

Runtime dependencies are few and pinned in `bun.lock`; the image installs with
`--ignore-scripts`, so nothing runs at install time. GitHub Actions are pinned to commit SHAs and
Dependabot opens weekly update pull requests for both. Scorecard and CodeQL run on every push to
main and publish their findings under the Security tab.

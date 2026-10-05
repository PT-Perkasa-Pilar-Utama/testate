# ADR 0004: HTTPS S3 endpoints retain their hostname

- **Date:** 2026-10-05
- **Status:** Accepted
- **Deciders:** Tech Lead

## Context

18 §18.7 requires outbound connections to use an address returned by netguard. Bun's `S3Client`
does not expose a TLS server-name option, so rewriting an HTTPS endpoint to its checked IP breaks
certificate name verification. This affects S3-compatible file adapters and the snapshot store.

## Decision

Pin plaintext `http:` S3 endpoints to the checked address. Keep the configured hostname for
`https:` endpoints so TLS can verify the certificate against that name. Netguard still checks the
configured hostname and port before a client is opened.

## Consequences

- HTTPS S3 connections rely on TLS hostname verification and are an exception to 18 §18.7's
  connect-to-the-returned-address rule; the hostname may resolve again when Bun opens the socket.
- Plain HTTP S3 endpoints continue to connect to the checked address.
- Revisit this decision when Bun exposes a way to keep the TLS server name while pinning the
  socket address.

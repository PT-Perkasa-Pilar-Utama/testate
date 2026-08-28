# Code Review Checklist

What a reviewer checks by hand. Everything the toolchain enforces (`bun run complete-check`) is assumed green before review starts. Standard: [CODING_STANDARD.md](CODING_STANDARD.md).

## Tests

- [ ] Each test names one behaviour and fails when it breaks. Ask: which line of the implementation kills this test?
- [ ] No expected value computed by the code under test; no call-only assertions; no re-recorded snapshots.
- [ ] Every refusal the service owns has a test (`code` and `details` asserted).
- [ ] Contract tests have a `breakIt` that makes the mock invalid for a real reason.
- [ ] No test opens a network connection unless tagged `contract`.

## Boundaries and security

- [ ] Every input parses with valibot at the edge: body, query, params, env, engine rows, MCP arguments.
- [ ] Every non-public route has `requireRole`; the minimum role matches the API spec.
- [ ] No credential, cookie, or bearer token reaches a log field, an error message, or a response.
- [ ] Sealed columns are in `lib/sealed/registry.ts` and the spec 17 table.
- [ ] Column policies apply on the new path (edits, imports, fixtures, agent reads).
- [ ] Outbound addresses go through the address policy (spec 18).

## Design

- [ ] Rung check: does this need to exist; does the codebase already have it; does Bun or the standard library do it?
- [ ] No abstraction with one implementation; no config for a value that never changes.
- [ ] Router has no logic; handler calls one service method; service takes deps; SQL sits in a repository.
- [ ] Long work is a job with progress and cancel, not a slow request.
- [ ] Frontend: model, presenter, view split; no `fetch` outside `api-client`; no component importing `features/`.

## Contract and docs

- [ ] Shared schema changed in the same PR as the API and the SPA that use it.
- [ ] `docs/api-specs/_index.md` status updated (`SCAFFOLD` → `OK` with tests).
- [ ] Spec section cited in the PR for any behaviour that is not obvious from the story.
- [ ] `SCAFFOLD:` removed from replaced code; new `ponytail:` markers name a ceiling and an upgrade path.

## Logging

- [ ] One wide event per request or job; fields added, no extra log lines.
- [ ] New fields use the existing sections (`actor`, `op`, `engine`, `job`, `error`) and snake_case names.

## Before approving

- [ ] `bun run complete-check` green on the branch.
- [ ] Smoke path run by hand for anything touching auth, boot, base path, or sealed values.

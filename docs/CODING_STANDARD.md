# Coding Standard

## Testate

**Version:** 1.0.0
**Date:** 2026-08-28
**Author:** Tech Lead
**Status:** Active

Rules marked **(enforced)** are checked by oxlint, oxfmt, tsc, or a git hook; reviewers do not check them by hand. Every other rule is on the [code review checklist](CODE_REVIEW_CHECKLIST.md). The seed rules from Sprint 0 (§1 and §2) stand unchanged.

---

## 1. Tautological tests considered harmful

A tautological test cannot fail when the behaviour it names is broken. It costs runtime, review time, and confidence, and it hides the missing test. None may land on `main`.

| Form | Example |
| --- | --- |
| Expected value produced by the code under test | `expect(fingerprint(schema)).toBe(fingerprint(schema))`, or an expected string copied from a previous run without checking it by hand |
| The unit under test is mocked | Mocking the engine driver and then asserting the driver was called |
| Only the call is asserted | `expect(spy).toHaveBeenCalled()` with no assertion on the outcome |
| No assertion, or an assertion inside a branch that may not run | `if (rows.length > 0) expect(rows[0].id).toBe(1)` |
| Snapshot re-recorded without review | `toMatchSnapshot()` updated with `-u` as a fix |
| The test passes with the implementation body deleted | Any test that survives `return undefined` in the function it names |

Rule: every test names one behaviour and fails when that behaviour breaks. Before a test is committed, the author breaks the implementation once (invert the condition, delete the branch) and watches the test fail. A test that stays green is rewritten or deleted.

Enforced by the oxlint `jest` plugin **(enforced)**: `expect-expect`, `no-conditional-expect`, `no-conditional-in-test`, `no-standalone-expect`, `valid-expect`, `no-identical-title`, `no-disabled-tests`, `no-focused-tests`, `prefer-strict-equal`, `require-to-throw-message`. `anti-slop/no-module-mocking` forbids `mock.module()`, so a test cannot replace the unit it names. Contract tests use `expectContract(schema, mock, breakIt)` from `apps/api/src/test/contract.ts`: the mock must parse, and the broken clone must fail. The remaining forms are review items.

## 2. Cyclomatic complexity gate

Every function stays at cyclomatic complexity 10 or under **(enforced)**: `complexity: ["error", { "max": 10 }]`. Branches, loops, `case` labels, `catch`, and `&&`, `||`, `??`, `?.`, `?:` each add one. A function over the limit is split by extracting a named function, not by suppressing the rule. `oxlint-disable complexity` does not appear in the codebase.

Why 10: a function with more than ten paths cannot be covered by a handful of tests, and the 300-line file cap already assumes small units. Restore planners, mapping transforms, and the route matcher are where this bites first; they need small, tested pieces most.

## 3. Files and names

- 300 lines per file **(enforced)**; split at 250.
- Backend module files: `<name>.router.ts`, `<name>.handler.ts`, `<name>.service.ts`, `<name>.repository.ts`, `<name>.mock.ts`, `<name>.test.ts`. Frontend feature files: `<name>.model.ts`, `<name>.presenter.ts`, `<name>.view.tsx`.
- Names say what a thing owns, not what shape it has: `AuditFilter`, not `FilterShape`; `reply()`, not `shape()` **(enforced by anti-slop)**.
- Kebab-case files, camelCase values, PascalCase types and components, SCREAMING_CASE for module constants.

## 4. Types

- No `any`, no non-null `!`, no `as` without a `// SAFETY:` line above it explaining why the assertion holds **(enforced)**.
- `type` over `interface`; string unions over enums; `readonly` arrays for constants.
- `Record<string, unknown>` is banned; use `JsonObject` and `JsonValue` from `@testate/shared` **(enforced)**.
- No `typeof` narrowing on values from outside the process; parse them with valibot at the boundary **(enforced)**. Inside the process, narrow on discriminants (`kind`, `view`, `status`).
- `exactOptionalPropertyTypes` is on: build optional fields conditionally instead of assigning `undefined`.
- Export return types on every exported function.
- Derive types from schemas (`v.InferOutput`); never write a shape twice.

## 5. Errors

- Throw `AppError` (or `notFound`, `conflict`, `forbidden`, `unauthorized`, `validationError`, `rateLimited`) from services; handlers never catch them; `errorResponse` renders the envelope.
- `catch (cause: unknown)`; rethrow with context or convert to `AppError`. Never swallow.
- Error messages are stable strings for the code path; details go into `details`. Tests assert `code` and `details`, not prose.

## 6. Boundaries

- Every input parses with valibot: bodies (`parseBody`), queries (`parseQuery`), params (`parseParams`, `param`), env (`lib/config`), engine rows, MCP arguments, uploaded files.
- Only `lib/config` reads the environment. Only `lib/api-client.ts` calls `fetch` in the SPA.
- Secrets are `Sealed` values from `lib/sealed`; the logger refuses forbidden keys; API responses show `{ set, set_at, key_fingerprint }`.
- A hashed column never receives raw input: column policies with required functions apply to edits, imports, fixtures, and agent reads.

## 7. Backend

- Routers mount handlers with `requireRole` and `describe`; no logic.
- Handlers parse, call one service method, and answer with `ok`, `okPage`, `accepted`, or `c.body(null, 204)`.
- Services are `createXService(deps)` returning an object of async methods; dependencies come in, never imported singletons.
- SQL lives in repositories, parameterized, one statement per method.
- Long work is a job: enqueue, answer 202 with `Location`, stream progress on `/jobs/{id}/events`.
- One wide event per request or job. Add fields with `event.add`; never `console.log` outside `lib/logger` and `scripts` **(enforced)**.

## 8. Frontend

- Solid 2 rules from `.claude/skills/solidjs-2`: two-argument `createEffect`, async `createMemo` under `<Loading>` and `<Errored>`, props read inside JSX or tracked scopes, `class` as string or structured array **(enforced by eslint-plugin-solid)**.
- Model calls the API and returns parsed types. Presenter owns signals and actions. View is JSX only.
- Components come from `components/` (Kumo ports). A component never imports `features/`.
- Route access is declared in `routes.ts` (`role: Role | null`); the shell enforces it; views assume it.

## 9. Tests

- `bun test`; one `<name>.test.ts` per module; Arrange-Act-Assert; one behaviour per test.
- Contract tests for every mock (`expectContract`). Behaviour tests for every branch a service owns (refusals first).
- No conditionals in tests **(enforced)**; narrow with a schema parse instead.
- Engine tests run against `deploy/compose.engines.yml` and are tagged `contract`; unit tests never open a network connection.

## 10. Comments and markers

- Comments explain why, cite a spec section (`07 §7.8`), or name a ceiling. No narration of what the code does.
- `// SCAFFOLD:` marks mock-backed code that a named card replaces.
- `// ponytail: <what> — <ceiling>; <upgrade path>` marks a deliberate shortcut. `grep ponytail:` lists them.
- `// SAFETY:` precedes every `as`.

## 11. Git

- Conventional Commits; subject 80 characters or fewer **(enforced by lefthook `commit-msg`)**.
- Pre-commit runs oxfmt on staged files, oxlint, and type-check **(enforced)**. CI runs `bun run complete-check`, boots the bundle, and smokes it.
- A pull request cites the story and the spec sections it implements and updates `docs/api-specs/_index.md`.

## 12. Dependencies

Minimum sufficient means: Bun built-ins, then the standard library, then an installed package, then new code. A new dependency needs a line in the PR naming what Bun and the installed packages could not do. Pin exact versions (`bunfig.toml` sets `exact = true`).

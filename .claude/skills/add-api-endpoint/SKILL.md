---
name: add-api-endpoint
description: Add or change a Testate REST endpoint end to end (shared schema, mock, service, handler, router, test, spec tracker) following the validated module pattern.
---

# Add an API endpoint

Every endpoint follows one pattern; the gate (`bun run complete-check`) validates it. Work through the steps in order; each one is a file with a fixed name.

## 1. Contract first: `packages/shared/src/schemas/<resource>.ts`

- Add or change the valibot schema. Export the output type with `v.InferOutput`.
- Query schemas: `parseQuery` uses `c.req.queries()`, so every field is `v.optional(v.array(...))` and the handler takes `[0]`.
- Body schemas with an either/or rule use `v.pipe(v.object(...), v.check(...))`.
- Re-export from `packages/shared/src/index.ts` if the file is new.

## 2. Mock: `apps/api/src/modules/<name>/<name>.mock.ts`

- One constant per response shape, typed with the schema's output type: `export const THING_MOCK: Thing = { ... }`. Never `as const`.
- Ids come from `apps/api/src/lib/mock/fixtures.ts`; reuse `PROJECT_SLUG`, `ADAPTER_ID`, `QA_ACTOR`, and friends.

## 3. Service: `<name>.service.ts`

```ts
export type ThingService = { list(slug: string): Promise<Thing[]>; ... };
export function createThingService(deps: ThingDeps): ThingService { return { async list(slug) { ... } }; }
```

- Refusals throw `notFound`, `conflict`, `forbidden`, `validationError`, or `new AppError(code, message, details)`.
- Mark mock-backed methods with `// SCAFFOLD:` and the card that replaces them.
- Long work returns a `Job` (`status: "queued"`) and the handler answers 202.

## 4. Handler: `<name>.handler.ts`

```ts
export type ThingHandlers = { list: Handler; create: Handler };   // explicit, never Record<...>
export function createThingHandlers(service: ThingService, apiPrefix: string): ThingHandlers {
  return {
    list: async (c) => okPage(c, await service.list(param(c, "slug")), null, 50),
    create: async (c) => accepted(c, await service.create(await parseBody(c, createThingSchema)), apiPrefix),
  };
}
```

Helpers from `lib/http/index.ts`: `ok`, `okPage`, `accepted`, `param`, `parseBody`, `parseQuery`, `parseParams`, `firstQuery`. The actor comes from `lib/http/auth.ts`: `currentActor(c)`, which every handler that needs one uses, never `c.get("actor")`.

## 5. Router: `<name>.router.ts`

```ts
const P = "/projects/:slug/things";
router.get(P, requireRole("viewer"), describe("things", "List things", v.array(thingSchema)), h.list);
router.post(P, requireRole("qa"), describe("things", "Create a thing (job)", jobSchema, 202), h.create);
```

- `requireRole` on every non-public route; the minimum role comes from the API spec.
- `describe(tag, summary, schema, status)` feeds `/openapi.json`; 204 routes pass `v.undefined()`.
- New module: add it to `modules/index.ts` (`V1Deps` + `createV1`) and wire the service and handlers in `src/index.ts`. Both files are wiring only.

## 6. Test: `<name>.test.ts`

- `expectContract(thingSchema, THING_MOCK, (m) => { m["id"] = 1; })` for every mock; the break must be a real contract violation.
- One `it` per refusal and per branch: `await expect(service.x(...)).rejects.toMatchObject({ code: "FORBIDDEN", details: { reason: "..." } })`.
- No conditionals in tests; narrow with a schema parse (`v.parse(v.object({ result: ... }), response)`).
- Break the implementation once and watch the test fail before committing.

## 7. Tracker and gate

- Update the row in `docs/api-specs/_index.md` (`TODO` → `SCAFFOLD` → `OK`).
- `bun run fmt:fix && bun run complete-check`. Then boot (`bun run dev:api`) and curl the route with a session cookie or `Authorization: Bearer tst_...`.

## Lint rules that bite here

| Rule | Fix |
| --- | --- |
| `anti-slop/no-unsafe-dictionary-type` | `JsonObject`, not `Record<string, unknown>` |
| `anti-slop/no-runtime-typeof` | `v.safeParse(v.string(), value)` |
| `anti-slop/no-known-value-widening` | Name the type (`AuditFilter`), do not inline an anonymous object type |
| `anti-slop/require-safety-comment-for-type-assertion` | `// SAFETY:` on the line above the `as`, or remove the `as` |
| `complexity` over 10 | Extract a named function or a lookup `Map` |
| `jest/no-conditional-in-test` | Parse with a schema, or split the test |

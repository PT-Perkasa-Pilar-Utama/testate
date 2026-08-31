---
name: add-frontend-feature
description: Add a screen to the Testate SPA in the model/presenter/view pattern with Solid 2, the in-house router, and the Kumo component ports.
---

# Add a frontend feature

A feature is one folder under `apps/web/src/features/<name>/` with three files. Read `.claude/skills/solidjs-2/SKILL.md` first; Solid 2 differs from Solid 1 in ways the linter catches late.

## 1. Model: `<name>.model.ts`

```ts
export const thingsModel = {
  list: (slug: string): Promise<Thing[]> =>
    apiClient.get(`/projects/${encodeURIComponent(slug)}/things`, { schema: v.array(thingSchema) }),
  create: (body: { name: string }): Promise<Thing> =>
    apiClient.post("/things", { schema: thingSchema, body }),
};
```

- `lib/api-client.ts` is the only `fetch`. It unwraps `{ data }`, parses with the schema, and throws `ApiError`.
- Body types must be plain JSON objects (`JsonObject`); with `exactOptionalPropertyTypes`, add optional keys conditionally.
- 204 routes take `schema: v.undefined()`.

## 2. Presenter: `<name>.presenter.ts`

```ts
export type ThingsPresenter = Refreshable<Thing[]> & { remove: (id: string) => Promise<void> };
export function createThingsPresenter(slug: () => string): ThingsPresenter {
  const things = createRefreshable(() => thingsModel.list(slug()));
  return { ...things, remove: (id) => attempt(async () => { await thingsModel.remove(id); things.refresh(); }) };
}
```

- `createRefreshable(load)` (in `lib/async.ts`) is an async memo with `refresh()`. Reads inside `load` are tracked, so pass props as accessors (`() => props.slug`), never as values.
- Form state is signals in the presenter; validation messages are a `string | null` signal.
- `attempt(task)` from `components/toast.tsx` reports an error as a toast.

## 3. View: `<name>.view.tsx`

- JSX only. Read async values under `<Loading fallback=...>`; the shell's `<Errored>` shows failures.
- Tables: `Table`, `Head`, `Row`, `Cell` from `components/table.tsx`. Status colours through a `const STATUS_VARIANT = { ... } as const` lookup, not a chain of ternaries.
- Forms: `Input`, `Select`, `Button`, `Dialog`, `Banner`. Banner variants: `default`, `alert`, `error`, `secondary`. Badge variants: `primary`, `secondary`, `error`, `warning`, `success`, `info`, `outline`.
- Role-gated controls: `<Show when={hasRole("qa")}>`.
- Links: `href={href(path)}` plus `onClick` that calls `navigate(path)` after `preventDefault`.

## 4. Route and navigation

- Add the name to `ROUTE_NAMES` and a `RouteDef` to `ROUTES` in `routes.ts` with `role: Role | null`. The shell (`app.tsx`) enforces access; views assume it.
- Add a `<Match>` in `Page` (`app.tsx`) and, for top-level screens, a `NAV` entry with its minimum role.
- Params come from `match().params` via the `param()` helper in `Page`.

## 5. Check

- `bun run type-check && bun run lint` (the `solid/reactivity` rule flags props read outside JSX or tracked scopes).
- `bun run dev`, open `http://localhost:7379`, sign in as `admin` (any password with 12+ characters in the scaffold), and click through the screen.
- The build bakes `/__TESTATE_BASE__/`; never hard-code `/api` or `/assets` paths outside `lib/`.

## Port a Kumo component

See `.claude/skills/kumo-design/SKILL.md`. Components live in `components/`, take `ComponentProps<"...">` plus variant props, use `class` arrays, and never import `features/`.

---
name: solidjs-2
description: SolidJS 2.0 (release candidate) API, migration rules from 1.x, and Testate's Solid conventions (model, presenter, view). Use this skill whenever you write, edit, or review any .tsx or .ts file under apps/web/src, any Solid component, signal, memo, effect, store, async data read, presenter, or router code, and whenever a Solid 1.x name appears (createResource, createAsync, onMount, on, batch, mergeProps, splitProps, unwrap, Suspense, ErrorBoundary, solid-js/web, solid-js/store). Also use it for questions about Solid 2.0 behaviour, flush timing, Loading and Errored boundaries, or eslint-plugin-solid v2 findings.
---

# SolidJS 2.0 in Testate

Solid 2.0 is a release candidate (`solid-js@2.0.0-rc.4`, `@solidjs/web@2.0.0-rc.4`, `@solidjs/vite-plugin@3.0.0-next.34`, pinned in `apps/web/package.json`, checked 2026-08-31; the `latest` tag is still 1.9.x). The `2.0.0-rc.3` copies of `solid-js` and `@solidjs/web` in `node_modules` are peer installs for `@solidjs/babel-plugin` and `@solidjs/compiler`, which are build-time only. The runtime resolves rc.4, which is what `patches/` patches. It is not a small bump from 1.x: DOM rendering moved to `@solidjs/web`, stores moved into `solid-js`, writes apply on a microtask flush, effects take two functions, and async data is a plain memo that returns a promise. Training data mostly knows 1.x, so check every Solid call against this skill before trusting memory. `eslint-plugin-solid` (v2 rules) runs under oxlint and rejects the 1.x names; the type checker rejects most of the rest.

Kobalte, Corvu, zaidan, Ark UI and every other Solid component library target Solid 1.x, so none of them can be used here. Ark UI is the concrete case: `@zag-js/solid`, the engine under every Ark component, imports `onMount` and `mergeProps` from `solid-js` and calls `createEffect` with one function. Solid 2 exports neither name and throws `MISSING_EFFECT_FN` on the one-argument form, so it fails at import, not at runtime. Its `2.0.0-next.1` prerelease has the same imports. Components are therefore hand-rolled under `apps/web/src/components/` in plain Tailwind (see the `design-system` skill).

## When to read which file

| Need | Read |
| --- | --- |
| Exact 2.0 signatures, imports, and copy-paste examples | `references/api.md` |
| tsconfig, JSX typing gotchas, lint rule meanings and how to satisfy them | `references/typescript-and-lint.md` |
| How Testate structures models, presenters, views, the router, and job progress | `references/project-patterns.md` |

## The rules that change how you write code

1. **Imports.** `render` and DOM `JSX` types come from `@solidjs/web`; everything reactive (`createSignal`, `createMemo`, `createEffect`, `createStore`, `Show`, `For`, `Loading`, `Errored`, `merge`, `omit`, `flush`) comes from `solid-js`. `solid-js/web` and `solid-js/store` do not resolve.
2. **Writes apply later.** `setCount(1); count()` still returns the old value until the microtask flush. Never read a signal right after setting it and expect the new value; in tests call `flush()`.
3. **Effects are two functions.** `createEffect(compute, effect)`: `compute` reads signals and returns a value, `effect(next, prev)` runs the side effect untracked and may return a cleanup. A single-argument `createEffect` throws `MISSING_EFFECT_FN` at runtime. `onMount`, `on`, and `batch` are gone; for a one-shot at construction, call the function in the component body.
4. **Async is a memo.** `createMemo(async () => ...)` is the only async primitive; read it like a value inside `<Loading fallback>`, catch rejections with `<Errored fallback={(error, reset) => ...}>`. `createResource` and `createAsync` do not exist. Re-run by changing a signal the memo reads; Testate presenters bump a `version` signal after every write.
5. **Props stay reactive.** Never destructure props. Defaults through `merge(defaults, props)`, forwarding through `omit(props, "a", "b")`, and capture the result in a variable before spreading. Pass values to DOM attributes (`value={name()}`), never accessors.
6. **Stores mutate drafts.** `setState((draft) => { draft.a.b = value; })`. `unwrap` is now `snapshot` and returns a deep copy.
7. **`class` is structured.** `class={[BASE, VARIANTS[v], { "text-danger-fg": bad() }]}`; no hand-built strings.
8. **Owners matter.** `createMemo`, `createEffect`, and `onCleanup` need an owner. Module-level code may create signals only. Anything with memos, effects, or cleanup lives in a `create<Feature>Presenter()` factory called from the view component.
9. **Views are JSX only.** No `fetch`, no valibot parsing, no `EventSource`, no `localStorage` in a `*.view.tsx`. The model talks to the API, the presenter owns state and actions, the view renders.

## Quick migration table

| Solid 1.x | Solid 2.0 |
| --- | --- |
| `import { render } from "solid-js/web"` | `import { render } from "@solidjs/web"` |
| `import { createStore } from "solid-js/store"` | `import { createStore } from "solid-js"` |
| `jsxImportSource: "solid-js"` | `jsxImportSource: "@solidjs/web"` |
| `createEffect(() => { ... })` | `createEffect(() => deps(), (deps) => { ... })` |
| `onMount(fn)` | call `fn()` in the component body |
| `on(dep, fn)` / `batch(fn)` | removed; use two-argument effects; writes batch by default |
| `createResource(src, fetcher)` / `createAsync(fn)` | `createMemo(async () => fetcher(src()))` |
| `<Suspense fallback>` | `<Loading fallback on={value}>` |
| `<ErrorBoundary fallback={(e, reset) => ...}>` | `<Errored fallback={(error, reset) => ...}>` (`error` is an accessor) |
| `mergeProps(a, b)` / `splitProps(p, keys)` | `merge(a, b)` / `omit(p, ...keys)` |
| `setState("a", "b", v)` | `setState((draft) => { draft.a.b = v; })` (`storePath` exists; do not use it) |
| `unwrap(store)` | `snapshot(store)` |
| `aria-selected={bool}` | `aria-selected={bool ? "true" : "false"}` |
| `@solidjs/router` `<Route>` / `useNavigate` | Testate's `lib/router.ts` (see `project-patterns.md`); the Solid 2 router line is still a prerelease |

## Verification

Run `bun run type-check && bun run lint` after any Solid change; both catch most 1.x leftovers. Behaviour that depends on flush timing, the router, server-sent events, or the DOM is checked by the Playwright smoke run against `bun run dev`, not by unit tests. Presenter logic is unit-tested with `bun test` inside `createRoot` with `flush()`.

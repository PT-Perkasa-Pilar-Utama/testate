# Solid 2.0 API reference (verified 2026-08-27, versions re-checked on npm 2026-08-28)

Sources: https://v2.solidjs.com/migration/from-solid-1, https://v2.solidjs.com/concepts/reactivity, https://v2.solidjs.com/concepts/stores, https://v2.solidjs.com/concepts/async-reactivity, https://v2.solidjs.com/concepts/boundaries, and the `reference/solid-js/*` pages linked below. Release state: `solid-js@latest` is 1.9.15; 2.0 lives under the `next` tag (`2.0.0-rc.3`). The site says: "APIs may change before the stable release, and packages from the coordinated RC must use compatible versions." Pin exact versions; bump on purpose.

## Packages

| Package | Role | Version in Testate |
| --- | --- | --- |
| `solid-js` | reactivity, stores, control flow, boundaries | 2.0.0-rc.3 |
| `@solidjs/web` | `render`, `hydrate`, DOM JSX types, `ComponentProps` | 2.0.0-rc.3 |
| `@solidjs/vite-plugin` | Vite plugin (renamed from `vite-plugin-solid`); classic mode with `index.html` | 3.0.0-next.34 |
| `@solidjs/router` | router; the Solid 2 line is `2.0.0-next.*`, a prerelease | not used; Testate has `lib/router.ts` |

```ts
// Solid 2
import { createStore, reconcile } from "solid-js";
import { render } from "@solidjs/web";
```

## Reactivity

### Writes apply on flush

https://v2.solidjs.com/concepts/reactivity

```js
import { createMemo, createRoot, createSignal, flush } from "solid-js";

const model = createRoot((dispose) => {
  const [first, setFirst] = createSignal("Ada");
  const [last] = createSignal("Lovelace");
  const fullName = createMemo(() => `${first()} ${last()}`);
  return { fullName, setFirst, dispose };
});

model.fullName(); // "Ada Lovelace"
model.setFirst("Grace");
model.fullName(); // still "Ada Lovelace"
flush();
model.fullName(); // "Grace Lovelace"
```

"Solid drains the pending work as one update pass on the microtask queue." `batch()` no longer exists (its reference page is a 404) because every write is already batched.

### createSignal

https://v2.solidjs.com/reference/solid-js/reactivity/create-signal

```ts
function createSignal<T>(): Signal<T | undefined>;
function createSignal<T>(value: Exclude<T, Function>, options?: SignalOptions<T>): Signal<T>;
function createSignal<T>(fn: ComputeFunction<T>, options?: SignalOptions<T> & MemoOptions<T>): Signal<T>;
```

The third overload is a writable memo: it starts as `fn()` and can be overwritten locally.

```ts
const [user, setUser] = createSignal(() => fetchUser(userId()));
setUser({ ...user(), name: "Alice" });
```

### createEffect

https://v2.solidjs.com/reference/solid-js/reactivity/create-effect

```ts
function createEffect<T>(
  compute: ComputeFunction<undefined | NoInfer<T>, T>,
  effectFn: EffectFunction<NoInfer<T>, T> | EffectBundle<NoInfer<T>, T>,
  options?: EffectOptions
): void;
```

"`createEffect(compute)` (single argument) is no longer supported. Pass a separate effect function as the second argument." `compute(prev)` is tracked and returns a value; `effectFn(next, prev)` is untracked and may return a cleanup. Pass `{ effect, error }` as the second argument to catch compute-phase errors, including async rejections. `createTrackedEffect` is the escape hatch for a single-phase tracked effect. `onMount` is gone: "For a one-shot side effect at construction time, just call the function." `on()` is gone (404).

```ts
createEffect(
  () => ({ open: props.open, dialog: element() }),
  ({ open, dialog }) => {
    if (dialog === undefined) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }
);
```

### Async memos, Loading, Errored

https://v2.solidjs.com/concepts/async-reactivity and https://v2.solidjs.com/concepts/boundaries

"Solid computations can return promises and async iterables. Consumers still read their accessors as reactive values instead of receiving the promise or iterator." Neither `createResource` nor `createAsync` exists in the 2.0 reference index.

```tsx
import { Errored, Loading, createMemo, createSignal, isPending } from "solid-js";

function ProjectPanel() {
  const [slug, setSlug] = createSignal("shop");
  const project = createMemo(async (): Promise<Project> => projectsModel.get(slug()));
  return (
    <Errored fallback={(error, reset) => (
      <section>
        <p>{String(error())}</p>
        <button onClick={reset}>Retry</button>
      </section>
    )}>
      <Loading on={slug()} fallback={<p>Loading project...</p>}>
        <h2 aria-busy={isPending(project) ? "true" : "false"}>{project().name}</h2>
      </Loading>
    </Errored>
  );
}
```

- `Loading`'s `on` prop is a plain value naming the answer in flight; changing it re-arms the fallback of an already-initialised boundary.
- `isPending(x)` is true while another answer for `x` is in flight and not yet revealed. `latest(fn)` reads the freshest in-flight value, falling back to the settled one (https://v2.solidjs.com/reference/solid-js/reactivity/latest).
- `<Reveal order="sequential" | "together" | "natural">` coordinates sibling `Loading` boundaries.
- Programmatic forms: `createErrorBoundary`, `createLoadingBoundary`.
- Refetch = change a signal the memo reads. There is no `refetch()`.

### untrack

https://v2.solidjs.com/reference/solid-js/reactivity/untrack

```ts
function untrack<T>(fn: () => T, strictReadLabel?: string | false): T;
```

The optional label turns on a dev warning when a reactive read happens inside `fn` without a nested tracking scope.

## Stores

https://v2.solidjs.com/concepts/stores

```ts
import { createEffect, createRoot, createStore, flush } from "solid-js";

const [state, setState] = createStore({ profile: { name: "Ada", online: false }, todos: [] as Todo[] });
createEffect(
  () => state.profile.name,
  (name) => console.log(`Name: ${name}`)
);
setState((draft) => {
  draft.profile.name = "Grace";
  draft.todos.push({ id: "1", text: "Write docs", done: false });
});
```

- Path setter still exists as an explicit helper: `setState(storePath("profile", "name", "Katherine"))`. Testate does not use it.
- `snapshot(store)` (https://v2.solidjs.com/reference/solid-js/advanced/store-advanced/snapshot) returns a plain deep copy; unchanged subtrees keep identity. `unwrap` is gone.
- `createProjection(fn, seed, options)` is "like `createMemo` but for stores", reconciled by `options.key` (default `"id"`).
- `createOptimistic` / `createOptimisticStore` + `action(function* () { ... })` + `refresh(source)` cover optimistic mutations. Allowed only in `*.presenter.ts`; not used in Testate yet.

## Props helpers

https://v2.solidjs.com/reference/solid-js/stores/merge and https://v2.solidjs.com/reference/solid-js/stores/omit

```ts
function merge<T extends unknown[]>(...sources: T): Merge<T>;
function omit<T extends Record<any, any>, K extends readonly (keyof T)[]>(props: T, ...keys: K): Omit<T, K>;
```

```tsx
function Button(props: { label: string; type?: string; disabled?: boolean }) {
  const local = merge({ type: "button", disabled: false }, props);
  const rest = omit(local, "label");
  return <button {...rest}>{local.label}</button>;
}
```

`omit(p, "a", "b")` is "the equivalent of `splitProps(p, ["a","b"])[1]`". Destructuring reactive props logs a dev warning in 2.0 and is a lint error here.

## Control flow

`Show`, `Switch`/`Match`, `For`, `Index` behave as in 1.x. `Show` with a function child passes a narrowed accessor (`{(u) => <Greeting name={u().name} />}`); `keyed` remounts on identity change. New: `<Repeat count={n}>` and the `repeat` primitive next to `For`/`mapArray`.

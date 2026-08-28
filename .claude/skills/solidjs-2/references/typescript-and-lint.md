# TypeScript and lint for Solid 2.0

## tsconfig (`apps/web/tsconfig.json`)

```json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "@solidjs/web",
    "lib": ["DOM", "DOM.Iterable", "ESNext"],
    "types": ["vite/client"]
  }
}
```

Type imports: `import type { JSX, ComponentProps } from "@solidjs/web"` for DOM-shaped types (component return type is `JSX.Element`); renderer-neutral types such as `Component` come from `solid-js`. Presenter tests run under `apps/web/tsconfig.node.json` with `"types": ["bun"]` and no DOM lib, so a presenter must not touch the DOM.

## Typing gotchas

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Type 'boolean' is not assignable to type 'EnumeratedPseudoBoolean'` on `aria-checked` / `aria-selected` | ARIA enumerated attributes want strings | `aria-checked={checked ? "true" : "false"}` |
| `Uint8Array<ArrayBufferLike>` not assignable to `Uint8Array<ArrayBuffer>` | TS 5.7+ typed-array generics; Web APIs (`crypto.subtle`, `Blob`, streams) want `ArrayBuffer` | Annotate params and returns as `Uint8Array<ArrayBuffer>`; `new Uint8Array(n)`, `.slice()`, and `TextEncoder.encode()` already produce them |
| `Missing return type on function` on `createXPresenter()` | `explicit-module-boundary-types` and `ReturnType<typeof create...>` is circular | Declare `export type XPresenter = { ... }` with function-typed members and annotate the factory |
| `The explicit anonymous object type ... discards known type evidence` (anti-slop) | inline object return types | Name the type (`type RowCount = { rows: number; bytes: number }`) |
| `Record<K, string>` flagged as open dictionary | anti-slop `no-known-value-widening` | `{ ... } as const satisfies Record<K, string>` and iterate a const key array |
| `Object.keys(x) as K[]` flagged | `require-safety-comment-for-type-assertion` | Export a `readonly K[]` constant and iterate that |
| Response shape typed by hand next to a valibot schema | duplicated truth | `type X = InferOutput<typeof xSchema>` from `@testate/shared` |

## eslint-plugin-solid v2 under oxlint

`.oxlintrc.json` sets `"settings": { "solid": { "version": 2 } }` and enables:

| Rule | What it rejects | How to satisfy |
| --- | --- | --- |
| `solid/removed-api` | `solid-js/web`, `solid-js/store`, `onMount`, `on`, `batch`, `createResource`, `mergeProps`, `splitProps`, `unwrap`, `Suspense`, `ErrorBoundary` | Use the 2.0 names in `api.md` |
| `solid/no-single-arg-create-effect` | `createEffect(fn)` | `createEffect(compute, effect)` |
| `solid/no-accessor-as-prop` | `value={name}` where `name` is a signal | `value={name()}` |
| `solid/no-destructure` | `function C({ a })` or `const { a } = props` | read `props.a` in JSX or tracked scopes |
| `solid/reactivity` | reactive reads in functions that are not passed to JSX, effects, or event handlers; inline `omit(props, ...)` in a spread | Capture `const rest = omit(props, "class")` in a variable; for listeners registered outside Solid (keyboard shortcuts, `EventSource` callbacks), wrap the block in `// oxlint-disable solid/reactivity -- reason` ... `// oxlint-enable solid/reactivity` |
| `solid/jsx-no-undef` | unknown JSX names | import the component |
| `solid/prefer-structured-class` (warn) | template-string class building | `class={[a, b, { c: cond() }]}` |

`promise/prefer-await-to-then` also fires on `.catch()`. Event handlers that start async work call `attempt(task)` from `components/toast.tsx`, which awaits inside try/catch and toasts the failure.

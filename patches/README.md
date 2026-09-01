# Patched dependencies

## `@solidjs/signals@2.0.0-rc.4`

One line in `commitPendingNodes`, in each of the three builds (`dist/dev.js`,
`dist/prod/core/scheduler.js`, `dist/node.cjs`; the last two with mangled field names, `_transition`
as `_e` and `O`):

```js
const node = pendingNodes[i];
commitPendingNode(node);
node._transition = null;
```

**What it fixes.** A node's `_transition` stamp is cleared only for optimistic nodes and in one
async settle. Everything else relies on `reassignPendingTransition`, which runs over
`batch._pendingNodes` when the transition completes. `commitPendingNodes` drains that list without
clearing anything, so a node committed by an earlier drain keeps pointing at a transition that later
finishes.

`setSignal` then re-enters that stamp before it discovers a write changes nothing, and a `Loading`
boundary rewrites the same flag on every pass of a drain. So a write that changes nothing re-arms a
transition that can never complete again, and `flush()` never ends. The dev build throws "Potential
Infinite Loop Detected" at 100,000 passes. The production scheduler runs the same loop with no
counter, so it hangs: a frozen tab and a pinned core, on the data grid.

**Evidence.** `docs/upstream-solid-flush-loop.md` holds the instrumentation record. Solid's own
suite passes with and without the change (114 files, 1432 tests). Over our browser crawl, scoring
runaways, `RangeError` and every page error: unpatched, the condition arose in 5 of 10 runs and all
5 span; patched, 12 of 12 runs were clean and the condition never arose at all.

**Do not reinvent this.** Two other repairs were tried and both are wrong. Refusing the finished
transition inside `initTransition` opens a fresh batch instead and the drain still spins. Clearing
the stamp at the write in `setSignal` stops the spin but corrupts the pending-node bookkeeping,
because the fresh ambient batch aliases the dead transition's arrays and the adoption pass then
pushes into the array it is iterating (`RangeError: Invalid array length`). That second one was
briefly shipped here and reverted.

**Ceiling and upgrade path.** Submitted upstream as `solidjs/solid#3143`, which closes
`solidjs/solid#3140`. Drop this patch when a release carries the fix. On any `@solidjs/signals`
upgrade `bun install` will fail to apply it, which is the signal to check whether it is still needed
rather than to force it through.

## `@formisch/solid@1.0.0`

Two functions restored to `dist/index.jsx` and `dist/dev.jsx`, the raw-JSX builds that Formisch
serves through its `solid` export condition:

```js
const batch = (fn) => fn();          // Solid 2 batches on a microtask and dropped `batch`
function splitProps(props, keys) {   // Solid 2 dropped it; getters keep the rest reactive
```

**What it fixes.** Formisch declares `"solid-js": ">=1.6 <2"`, and the reason is exactly two
imports. Its Solid adapter asks for `batch` and `splitProps`, which Solid 2 removed; every other
API it uses (`createSignal`, `createMemo`, `createUniqueId`, `untrack`, `onCleanup`) Solid 2 still
exports. `splitProps` appears once, in `<Form>`, stripping `of` and `onSubmit` before spreading the
rest onto the native `form`, so the shim preserves getters rather than copying values or the
spread would freeze. `batch` is a straight call-through: Solid 2's own CHEATSHEET replaces it with
"default microtask batching; `flush()` to apply now".

Two more, found by the browser suite rather than by reading. Solid 2 ships reactivity diagnostics
that this repo treats as failures, and `<Field>` tripped two of them on every form:

- `props.autofocus` read `errors.value` eagerly, so it was a reactive read outside any tracking
  scope (`STRICT_READ_UNTRACKED`) and a snapshot that never updated. It is a getter now, which is
  also what the surrounding properties already were.
- The `ref` callback registered `onCleanup`, and Solid 2 runs a ref outside the owner, so that
  cleanup would never have run (`NO_OWNER_CLEANUP`): a field's element was never removed from its
  store on unmount. `useField` captures the owner and the registration runs inside it.

Both are latent bugs on Solid 1 too, where they are a lint warning and a leak rather than a
diagnostic; Formisch's own `eslint-disable solid/reactivity` sits on the first one.

**Why the `.jsx` builds and not the `.js` ones.** The compiled builds import from `solid-js/web`, a
subpath Solid 2 removed (it is `@solidjs/web` now), and there is no shimming that. The `solid`
export condition serves raw JSX instead, which the Solid vite plugin compiles itself and which
imports only from `solid-js`. `apps/web/vite.config.ts` therefore keeps Formisch out of dependency
pre-bundling, or esbuild resolves the `import` condition and pulls the wrong build. Both the dev
server and the production build take the patched JSX; the built bundle contains no reference to
`solid-js/web`, which is the check worth repeating after any upgrade.

**Evidence.** The sign-in form runs on it: fields validate against the shared valibot schema, the
messages appear under their own controls, typing clears them, `fill()` drives it the way the
browser suite does, and a rejected password comes back as a banner rather than a field error.

**Ceiling and upgrade path.** Drop this patch when Formisch ships a Solid 2 build; the peer range
is the thing to watch. `bun install` failing to apply it after an upgrade is the signal to check
whether the two shims are still needed rather than to force it through.

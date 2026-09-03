# Patched dependencies

One patch, and it is here because the package's peer range is wrong rather than because its code
is. Solid's own was removed on 2026-09-03: `@solidjs/signals@2.0.0-rc.6` ships the fix upstream
(`solidjs/solid#3143`), and rc.5 carried it too.

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

The fourth is the one that mattered most, and it hid behind the other three. Solid 1's `batch`
flushed on exit; Solid 2 batches to a microtask instead, and its own CHEATSHEET says "reads update
only after flush". Formisch writes and then reads inside a single batch, `reset` above all, where
`setInitialFieldInput` stores the new values and `walkFieldStore` immediately copies them into the
live input. Calling `batch` straight through left that read one value behind, so
`reset(form, { initialInput })` silently kept the old input and **every edit dialog prefilled with
stale values while the tests still went green on the create paths**. The shim flushes on exit, the
way Solid 1's did.

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

## The `overrides` block in the root `package.json`

```json
"overrides": { "solid-js": "2.0.0-rc.6", "@solidjs/signals": "2.0.0-rc.6" }
```

The same wrong peer range, spending a second time. Formisch asks for `solid-js >=1.6 <2`, and
while the app sat on rc.4 nothing showed: Bun hoisted the one copy and every package shared it.
Moving the app to rc.6 changed that. Bun stopped hoisting, gave Formisch a nested `solid-js@rc.4`
of its own, and pulled `@solidjs/signals@rc.4` under it.

Two copies of signals is two reactive graphs. A signal made in a form belongs to a different
module instance from the one every other screen reads, so nothing that crosses that line updates,
and it fails quietly rather than loudly. The old bug rides along too: the nested copy is
unpatched, and this repo's patch for it is gone because rc.6 fixed it upstream.

So the check after any Solid bump is one line, and it is not "does it build":

```sh
ls node_modules/.bun | grep -E 'solidjs\+signals|^solid-js@'
```

One entry each. Two means the override stopped doing its job. `bun install` alone will not tell
you: it reported "no changes" while `node_modules` still held the old tree, and only a clean
install made the disk match the lockfile.

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

# Patched dependencies

## `@solidjs/signals@2.0.0-rc.4`

One line, in `setSignal`, in each of the three builds (`dist/dev.js`, `dist/prod/core/core.js`,
`dist/node.cjs`, the last two with mangled field names):

```js
if (el._transition?._done === true) el._transition = null;
```

**What it fixes.** `setSignal` re-opens the node's transition before it checks whether the write
changes anything:

```js
if (el._transition && activeTransition !== el._transition)
  globalQueue.initTransition(el._transition);   // <- runs first
...
const valueChanged = ... || !el._equals(currentValue, v);
if (!valueChanged) return v;                     // <- and only then bails out
```

A `Loading` boundary keeps a boolean flag, and `CollectionQueue._checkSources` writes that flag on
every pass of a drain. When the flag is already `false`, the write changes nothing, but it has
already re-opened the node's transition. If that transition is one the node was stamped with and
which has since finished, the drain loop sees a live transition again and goes round. It never
makes progress and never ends.

A transition with `_done === true` is finished for good: `_done` is only ever a forwarding object,
which `currentTransition` follows, or the boolean `true`, which ends the chain. So the stamp is dead
and dropping it is safe. `resolveTransition` already refuses a finished transition on its override
branch; the plain write path did not.

**Why the guard is at the write and not inside `initTransition`.** Making `initTransition` refuse a
finished transition does not help: it opens a fresh batch instead, and the drain stays alive. That
was measured, not assumed.

**Evidence.** `docs/upstream-solid-flush-loop.md` holds the full instrumentation record. Under the
browser crawl, the condition and the runaway matched exactly: 5 of 10 unpatched runs met the
condition and all 5 span to the 100,000-iteration guard, while 6 patched runs met the same condition
and none of them span.

**Ceiling and upgrade path.** Filed upstream as `solidjs/solid#3140`. Drop this patch as soon as a
release carries the maintainers' own fix, which may well be at a different layer than this one. On
any `@solidjs/signals` upgrade `bun install` will fail to apply the patch, which is the signal to
re-check whether it is still needed rather than to force it through.

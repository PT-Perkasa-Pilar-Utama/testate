# The flush loop: cause, fix, and how it was found

**Status:** cause established and fixed locally. `patches/@solidjs%2Fsignals@2.0.0-rc.4.patch`
carries a one-line change to `setSignal`. Filed upstream as `solidjs/solid#3140`. Drop the patch
when a release carries the maintainers' own fix.

## The defect

`setSignal` re-opens the node's transition before it checks whether the write changes anything:

```js
if (el._transition && activeTransition !== el._transition)
  globalQueue.initTransition(el._transition);   // runs first
...
const valueChanged = ... || !el._equals(currentValue, v);
if (!valueChanged) return v;                     // and only then bails out
```

A `Loading` boundary holds a boolean flag. `CollectionQueue._checkSources` writes that flag on every
pass of a drain. When it is already `false` the write changes nothing, but it has already re-opened
the transition the node is stamped with. If that transition has already finished, the drain loop
sees a live transition again and goes round, forever:

1. The drain loop sees `activeTransition`, so it calls `globalQueue.flush()`.
2. `transitionComplete` returns true on its first line, because `_done` is already `true`. The
   transition completes and `activeTransition` becomes null.
3. Still inside that flush, `finalizePureQueue` reaches `checkBoundaryChildren`, which reaches
   `CollectionQueue._checkSources`, which writes `false` over `false`.
4. `setSignal` re-opens the finished transition before discovering the write is a no-op.
5. The loop condition is true again. Go to 2.

Nothing recomputes. The dirty queue is empty, nothing is scheduled, no effects are queued, there are
no pending nodes and no lanes. In the dev build the loop throws at 100,000 iterations. The
production scheduler has the same loop with no counter, so there it does not throw. It hangs.

## The fix

```js
if (el._transition?._done === true) el._transition = null;
```

`_done` is only ever a forwarding object, which `currentTransition` follows, or the boolean `true`,
which ends the chain. So a `_done === true` stamp is dead and dropping it is safe.
`resolveTransition` already refuses a finished transition on its override branch. The plain write
path did not.

**A guard inside `initTransition` does not work.** Refusing the finished transition there makes it
open a fresh batch instead, and the drain stays alive. That was measured: the spin survived, with a
different transition identity on each pass.

## How it was found

The message names nothing and every frame is internal, so the only way through was to instrument the
drain loop in a local copy of `dist/dev.js` and run the browser crawl until it tripped.

| Probe | Question | Answer |
| --- | --- | --- |
| report scheduler state at iteration 200 | is anything actually queued? | no: empty heap, nothing scheduled, no effects, no pending nodes |
| track transition identity across passes | one transition or many? | the same one, already `_done`, re-armed every pass |
| guard `initTransition` | does refusing it help? | no: a fresh batch per pass, still spinning |
| count reads per node during a drain | which node? | one node, on 99,997 of 100,000 passes |
| hook all four re-open sites | which path? | `setSignal`, which the first probes missed |
| capture the writer | who writes it? | `CollectionQueue._checkSources` under `finalizePureQueue`, writing `false` over `false` |

## The measurement

Both arms ran the same crawl with the same counters, differing only in that one line. A run only
counts as evidence if the stale-stamp condition actually arose in it, because a run that never met
the condition cannot say anything about the fix.

| Arm | Runs that met the condition | Drains over 25 passes | Runaways |
| --- | --- | --- | --- |
| unpatched | 5 of 10 | 5 of 5 | 5 of 5 |
| patched | 6 | 0 of 6 | 0 of 6 |

In the unpatched arm the condition and the runaway matched exactly, ten times out of ten: every run
that met it span, every run that did not was clean. That is what makes the patched arm readable.

The stale-stamp counts differ between arms by construction. Unpatched runs count 9 or 18 because the
stamp stays and the same node keeps hitting it. Patched runs count 3 because the first contact
clears it.

## What was ruled out along the way

- Our data layer. The rewrite onto `refresh()` and a memo for the derived page was right on its own
  merits and changed nothing here.
- The grid's table-change effect. Removing it (`089713a`) is right on its own merits and changed
  nothing here.
- `fkLink`, and the two server-sent-event effects.

## Reproducing it

`bunx playwright test --project=crawl --no-deps` against a seeded `.e2e/data`, repeatedly. It met
the condition in about half of runs. A single screen driven hard never reproduces it; the crawl
across thirty screens does.

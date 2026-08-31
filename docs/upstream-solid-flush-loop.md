# The flush loop: cause found, repair not found

**Status:** open. The cause is established by measurement and reported upstream as
`solidjs/solid#3140`. Two candidate repairs were tried and both rejected, one of them after it was
briefly committed here. **We ship no patch.** The loop is still present.

## The cause

`setSignal` re-opens the node's transition before it checks whether the write changes anything:

```js
if (el._transition && activeTransition !== el._transition)
  globalQueue.initTransition(el._transition);   // runs first
...
const valueChanged = ... || !el._equals(currentValue, v);
if (!valueChanged) return v;                     // and only then bails out
```

A `Loading` boundary holds a boolean flag. `CollectionQueue._checkSources` writes that flag on every
pass of a drain. When it already holds the value the write does nothing, but it has already
re-opened the transition the node is stamped with. If that transition has finished, the drain loop
sees a live transition again and goes round:

1. The drain loop sees `activeTransition`, so it calls `globalQueue.flush()`.
2. `transitionComplete` returns true on its first line, because `_done` is already `true`. The
   transition completes and `activeTransition` becomes null.
3. Still inside that flush, `finalizePureQueue` reaches `checkBoundaryChildren`, which reaches
   `CollectionQueue._checkSources`, which writes `false` over `false`.
4. `setSignal` re-opens the finished transition before discovering the write is a no-op.
5. The loop condition is true again. Go to 2.

Nothing recomputes. The dirty queue is empty, nothing is scheduled, no effects are queued, there are
no pending nodes, no async reporters and no lanes. The dev build throws at 100,000 iterations. The
production scheduler runs the same loop with no counter, so there it hangs instead.

## The two repairs that failed

**Refusing the finished transition inside `initTransition`.** It opens a fresh batch instead, and
the drain keeps spinning with a new transition identity on each pass.

**Clearing the stamp at the write, `if (el._transition?._done === true) el._transition = null`.**
This stops the spin and corrupts the pending-node bookkeeping:

```
RangeError: Invalid array length
  > queuePendingNode   dist/dev.js:1640
  > recompute / runHeap / GlobalQueue.flush / flush
```

Measured over the same crawl, the error appeared only with that patch and only on runs that met the
condition: 2 of the 4 such runs, against 0 of 10 unpatched runs. So the stamp is not dead even when
`_done` is true; something downstream still expects the node to carry it. That patch was committed
as `25c28e9` and reverted.

## The measurement that matters

A run is evidence only if the stale-stamp condition arose in it. In the unpatched build the
condition and the runaway match exactly:

| Arm | Runs meeting the condition | Runaways | `Invalid array length` |
| --- | --- | --- | --- |
| unpatched | 5 of 10 | 5 of 5 | 0 |
| stamp cleared at the write | 4 of 14 | 0 of 4 | 2 of those 4 |

Ten for ten on the unpatched side: every run that met the condition span, every run that did not was
clean. Any future candidate must be judged the same way, and must count every page error, not only
the loop. Counting only the loop is how the bad patch passed.

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

## What was ruled out along the way

- Our data layer. The rewrite onto `refresh()` and a memo was right on its own merits and changed
  nothing here.
- The grid's table-change effect. Removing it (`089713a`) is right on its own merits and changed
  nothing here.
- `fkLink`, and the two server-sent-event effects.

## Reproducing it

`bunx playwright test --project=crawl --no-deps` against a seeded `.e2e/data`, repeatedly. It met
the condition in about half of runs. Driving a single screen hard never reproduces it; the crawl
across thirty screens does.

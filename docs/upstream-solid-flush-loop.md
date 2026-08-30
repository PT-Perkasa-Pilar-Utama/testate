# Upstream report: "Potential Infinite Loop Detected" on a screen with several async memos

**Status:** open, not fixed here. Written to be pasted into an issue on `solidjs/solid` once someone
decides to file it. Nobody has filed it yet.

## What happens

Solid's dev build throws `Potential Infinite Loop Detected` from the flush guard while the browser
sits on our data-grid screen. The page keeps working; the error reaches `window.onerror`, which is
how our browser suite catches it.

The guard is `flush()` counting its own iterations:

```js
let count = 0;
while (scheduled || activeTransition) {
  if (++count === 1e5) throw new Error("Potential Infinite Loop Detected.");
  ...
}
```

So something reschedules work a hundred thousand times inside one flush.

## Frames

Every occurrence carries the same three, and no frame of ours:

```
at flush      (@solidjs/signals dev, the guard above)
at asyncWrite (@solidjs/signals dev)
at result.then.syncError (@solidjs/signals dev)
```

`asyncWrite` and `result.then.syncError` put it in the write-back of a settled async computation.

## Where

`/projects/:slug/adapters/:id/tables/:table`, always. That screen holds four async computations
built on `createMemo(async …)`: the page of rows (whose query the person controls: filters, sort,
cursor, page size), the adapter, its schema, and a write-session presenter that refreshes the first
one. It is the only screen in the product with that many, and the only one whose async memo takes a
query a person can change quickly.

## Conditions

- Seen 4 times in about 15 full browser-suite runs (Playwright, Chromium, headless).
- Always during the crawler project, which clicks every control on every screen in turn.
- Never in a crawler run on its own: 3 consecutive clean runs.
- Never in a dedicated stress spec that drives the same screen's sort, filter, paging and write
  switch 20 times over with no wait between clicks, with and without a query the API rejects:
  6 clean runs (`e2e/stress.e2e.ts`, project `stress`, `STRESS=1`).
- The difference between the two is what ran before: in a full suite the crawler arrives after
  every other project has taken snapshots, run checkouts, imported fixtures and left jobs
  streaming over server-sent events.

## Versions

`solid-js` and `@solidjs/web` 2.0.0-rc.4, `@solidjs/signals` transitively. It happened on rc.3 as
well, and rc.4's note about a flush loop spinning forever on a pending store read (#3068) did not
end it.

## What was ruled out

- `fkLink`, the grid's only pure helper on that path.
- The grid's table-change effect: its handler writes nothing its own source reads.
- The two server-sent-event effects (`jobs.presenter.ts`, `checkouts.view.tsx`): the source value
  does not change when the list refreshes, so the handler does not re-run.

## What a reproduction would need

An instance with enough accumulated state to match a full run, then the crawler's own pattern of
clicking every control including the dialogs. Our own harness gets there about one run in four.

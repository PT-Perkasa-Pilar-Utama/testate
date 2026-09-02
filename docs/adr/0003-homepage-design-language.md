# ADR 0003: The homepage's design language, inside the app

- **Date:** 2026-09-02
- **Status:** Accepted. Supersedes ADR 0002 (GitHub's design language, 2026-08-30), which is
  removed; what still holds from it is restated below.
- **Deciders:** Product owner (direction), Tech Lead (implementation)

## Context

The SPA was restyled after GitHub on 2026-08-30 (ADR 0002). On 2026-09-02 the product owner, having seen the project
homepage (`docs/index.html`, the same language on the README banner), asked for the app to match
it: "I really like the web demo style. The current UI style is really bad." The homepage is dark,
near-black rather than black, with one raised surface, hairline borders, tight headings in Mona
Sans, mono upper-case labels, teal for what you can act on and the mark's green for identity.

## Decision

The app takes the homepage's palette and vocabulary and keeps the structure the GitHub pass
built: the tokens stay in the Tailwind `@theme` block under the same names, one name generating
every utility family; a status is three tokens (`danger`, `danger-tint`, `danger-fg`) because one
name cannot be both a fill and a text colour; the component layer under
`apps/web/src/components/` stays hand-rolled because no Solid 2 component library exists; content
text stays 14px because the screens are tables; Mona Sans is served from the instance and never
from a CDN because nothing leaves your network; motion stays at 80 ms and `prefers-reduced-motion`
removes it. No DOM, role or label changed, so the browser suite selects exactly what it selected
before.

What changed, in `apps/web/src/styles/app.css` and the components:

| Concern | The GitHub pass | Now |
| --- | --- | --- |
| Ground and surface | `#000000`, `#0d1117` | `#05070a`, `#0b1017`, with a soft teal glow painted once on the root |
| Lines | grey at 25% and 15% | off-white at 16% and 8%, so they read the same on either ground |
| Accent | GitHub cyan `#8dd6ff` | the mark's teal `#7dd3c0`; cyan stays as `info`. As a fill it is the `accent` button, reserved for the product's own verbs: Take state, Check out, Insert row |
| The one solid button | cyan | ink on the ground (`bg-body text-inverse`), the homepage's call to action |
| Destructive in a row | solid red | a quiet `danger` variant: red text on a line; the confirm dialog carries the solid red |
| Table heads | 12px sentence case | mono, 11px, upper-case, spaced; the grid's column names keep their own case |
| Headings | tracking untouched | `tracking-tight`, as every heading on the homepage |
| Radii | 6 / 6 / 8 / 12 | 6 / 8 / 12 / 16 |
| Labels | none | `Eyebrow` in `page-header.tsx`: the homepage's mono label, over a title or a group |
| Wordmark | "Testate" | "Test" plus "ate" in green, as the homepage and the banner set it |
| Hover | no transition | 80 ms colour transition, the specification's fast tier |

The light theme stays, as a mapping rather than a design: the homepage has none. The teal darkens
to the mark's own dark teal (`docs/assets/logo-dark.svg`), washes lighten, lines turn grey.
`scripts/check-contrast.ts` holds both palettes to the same floors and passes.

## Amendment, 2026-09-02 (afternoon)

The product owner judged the first pass surface-deep and asked for the homepage's language to
run through the screens, not only the tokens. What that added:

- The home screen is a bento on the homepage's line grid (`LineGrid`, `Stat`), with cards that
  stretch to their row and centre an empty line rather than leaving a hollow.
- Every screen under a project starts with a breadcrumb path in the mono label.
- Take state is the one solid teal on the states screen; Check out is teal on every state but the
  one the databases hold, where it is quiet and says so. That needed the API to know whether the
  databases still hold HEAD: `head.dirty` (migration 0007), set by Testate's own writes, cleared by
  a checkout or a snapshot, settled by a diff of HEAD against the live databases, which "Check for
  changes" on the HEAD row runs. Outside writes stay invisible until that check runs, which the
  screen says by never disabling the button.
- Write mode is a strip under the grid toolbar. The diff page's rail names each database and
  colours what moved. The activity tab colours only a failure. Every mutation ends in a toast.

## Consequences

- `.claude/skills/design-system/SKILL.md` is the reference again and was rewritten to match; its
  "never touch tracking" and "never transition a hover" rules are gone.
- The README screenshots were retaken (`SHOTS=1 bunx playwright test --project=screens`).
- Anything styled by hand in a feature view that reached for the old values reads from the same
  tokens, so it moved with them; the sweep touched seventeen views only for heading size and to put
  cards on the raised surface.

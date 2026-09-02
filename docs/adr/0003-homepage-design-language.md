# ADR 0003: The homepage's design language, inside the app

- **Date:** 2026-09-02
- **Status:** Accepted. Supersedes the look decided in ADR 0002; keeps its structure.
- **Deciders:** Product owner (direction), Tech Lead (implementation)

## Context

ADR 0002 restyled the SPA after GitHub. On 2026-09-02 the product owner, having seen the project
homepage (`docs/index.html`, the same language on the README banner), asked for the app to match
it: "I really like the web demo style. The current UI style is really bad." The homepage is dark,
near-black rather than black, with one raised surface, hairline borders, tight headings in Mona
Sans, mono upper-case labels, teal for what you can act on and the mark's green for identity.

## Decision

The app takes the homepage's palette and vocabulary and keeps ADR 0002's structure: the tokens
stay in the `@theme` block under the same names, the three-token status rule stands, the
component layer under `apps/web/src/components/` stays hand-rolled, and no DOM, role or label
changed, so the browser suite selects exactly what it selected before.

What changed, in `apps/web/src/styles/app.css` and the components:

| Concern | ADR 0002 | Now |
| --- | --- | --- |
| Ground and surface | `#000000`, `#0d1117` | `#05070a`, `#0b1017`, with a soft teal glow painted once on the root |
| Lines | grey at 25% and 15% | off-white at 16% and 8%, so they read the same on either ground |
| Accent | GitHub cyan `#8dd6ff` | the mark's teal `#7dd3c0`; cyan stays as `info` |
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

## Consequences

- `.claude/skills/design-system/SKILL.md` is the reference again and was rewritten to match; its
  "never touch tracking" and "never transition a hover" rules are gone.
- The README screenshots were retaken (`SHOTS=1 bunx playwright test --project=screens`).
- Anything styled by hand in a feature view that reached for the old values reads from the same
  tokens, so it moved with them; the sweep touched seventeen views only for heading size and to put
  cards on the raised surface.

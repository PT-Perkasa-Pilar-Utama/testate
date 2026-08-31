# ADR 0002: GitHub's design language, on Kumo's tokens

- **Date:** 2026-08-30
- **Status:** Accepted
- **Deciders:** Product owner (design direction), Tech Lead (implementation)

## Context

The four-team review returned 27 interface findings, and the product owner's
verdict on the interface was that it is bad. The direction is concrete rather than a matter of
taste: **make it look and behave like GitHub**. Every developer and tester already has GitHub open,
and the product's own pitch is "git for your test database", so borrowing that language costs the
reader nothing to learn.

The SPA is built from hand-rolled SolidJS components under `apps/web/src/components/` that carry
Cloudflare Kumo class strings and read Kumo's CSS variables (`--color-kumo-*`,
`--text-color-kumo-*`). Roughly forty views consume those variables through Tailwind utilities
(`bg-kumo-base`, `text-kumo-subtle`, `ring-kumo-line`).

The supplied design specification (GitHub, dark) is in `docs/design/github.md`.

## Decision

**Retarget Kumo's tokens; keep Kumo's component API.** The palette, radii, and type scale are
redefined in `apps/web/src/styles/app.css`, after the Kumo import so the cascade lands on our
values. No component has to learn a new class vocabulary, no view changes to re-skin, and the
component pass that follows is about size, radius, border and focus, not about colour.

The alternative, a new token vocabulary, would have touched every view for the same result.
Vendoring an edited copy of Kumo's stylesheet was rejected outright: it would fork a dependency we
do not own and lose every upgrade.

**Dark only.** The specification supplies one palette. `<html data-mode="dark">` and
`color-scheme: dark` pin it, so `light-dark()` inside Kumo's stylesheet always resolves to the dark
half, and the browser paints form controls and scrollbars to match.

### Where the specification contradicts itself

Four tokens could not be used as written. Each resolution is the specification's own reasoning:

| Token as given | Why it cannot stand | What we use |
| --- | --- | --- |
| `text-muted: #000000` | Black on a black page. The specification's own accessibility section says "never use black text on black background in dark mode". | `#8b949e`, GitHub's own muted text, 8.2:1 on black. The specification suggests `#484f58`, which is 3.2:1 and fails AA for body text. |
| `border: #ffffff` | Solid white borders on every card are not what GitHub looks like, and the specification never shows one. | `rgba(209, 217, 224, 0.25)`, which is the 1px ring inside the specification's own `card` shadow. Over black it resolves close to GitHub's `#30363d`. |
| White text on the cyan primary | The specification measures it at 3.2:1 and says it fails AA. | `on-primary: #111111`, which the specification itself recommends and already carries as a token. |
| Heading 22px vs 24px, mono 16px vs 12px | Front matter and prose disagree. | The front matter wins: it is the structured half of the specification, the prose is commentary. |

Two additions the specification does not cover but the product needs: a third surface for hover and
row striping (`#161b22`, GitHub's own), and status colours for the badges and banners that carry
job outcomes (`#3fb950`, `#d29922`, `#f85149`, GitHub's own).

**Content text stays 14px.** The specification's 16px body is GitHub's marketing site, not its
application, and Testate's tables are dense. `docs/CODING_STANDARD.md` and the `kumo-design` skill
both already require 14px for content, 16px and above for headings.

**Mona Sans is not fetched at runtime.** The README promises that nothing leaves your network; a
call to a font CDN would break that promise on every page load. The stack falls back to the
system's own UI font until someone vendors the woff2, which its SIL Open Font License allows.

**Motion stays at the fast tier.** 80ms for focus and hover, nothing for page transitions: an
internal tool should feel instant, and the specification says its motion is never decorative.
`prefers-reduced-motion` removes what is left.

## Consequences

- One CSS block re-skins every screen. A view that hardcodes a colour instead of a token now shows
  up as the one element that did not change; that is a feature of this approach.
- The README screenshots all become dark and are regenerated once the screens land.
- Kumo's own light palette is still in the bundle, unused. That is the cost of not forking it.
- Any future light mode means supplying the other half of every token, not undoing this.

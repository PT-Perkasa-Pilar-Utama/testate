---
name: design-system
description: Testate's design tokens and UI rules. The homepage's design language (ADR 0003) in plain Tailwind 4, the token names and what each one is for, the three-token status rule, and the conventions every hand-rolled component in apps/web/src/components follows. Use whenever you style a screen, add or change a component, pick a colour, or review a diff that touches class strings.
---

# Testate's design system

The homepage's design language (ADR 0003, on ADR 0002's structure), in plain Tailwind 4. There is
no component library. Every
component is hand-rolled under `apps/web/src/components/`, and every colour comes from a token
defined in `apps/web/src/styles/app.css`.

`@cloudflare/kumo` used to supply the token namespace and was removed on 2026-08-31: it carried a
whole component library nobody imported. Nothing replaced it. Tailwind 4 generates a utility for
every custom property in an `@theme` block, which is all we ever used it for.

Read `docs/design/github.md` for the specification and ADR 0002 for the four places that
specification contradicts itself. Neither is restated here.

## Tokens

One `@theme` name generates every utility family for that colour: `--color-surface` is
`bg-surface`, `text-surface`, `border-surface`, `ring-surface`. There is no separate text palette.

### Surfaces and structure

| Token | Value | For |
| --- | --- | --- |
| `canvas` | `#05070a` | the page ground, painted on `<html>` with the homepage's soft teal glow |
| `surface` | `#0b1017` | a card, a table, a dialog, a frozen cell: anything raised off the ground |
| `sunken` | `#030508` | below the ground; the sidebar, a read-only field, a well |
| `hover` | `#10161e` | row hover |
| `fill` | `#121a24` | a filled control at rest: a secondary button, a neutral badge, a progress track |
| `fill-hover` | `#1a2431` | that control under the pointer |
| `control` | `#0b1017` | an input's ground |
| `line` | `rgba(238,242,245,0.16)` | the 1px ring that is really a border |
| `hairline` | `rgba(238,242,245,0.08)` | a divider inside a component, quieter than `line` |

### Accent

| Token | Value | For |
| --- | --- | --- |
| `accent` | `#7dd3c0` | what is active or focused: the focus ring, the active tab and nav entry, a link, HEAD's dot. Not a button fill |
| `accent-hover` | `#9ae3d3` | a link under the pointer |
| `on-accent` | `#05070a` | text sitting on `accent`. White on teal fails AA; never use it |
| `link` | `#7dd3c0` | link text |

There is no `focus` token. The focus ring is the accent: `focus-visible:outline-2
focus-visible:outline-offset-2 focus-visible:outline-accent`.

### Status: three tokens, never one

Kumo kept two namespaces, so `bg-kumo-danger` and `text-kumo-danger` were different reds. One
`@theme` name cannot do that. So a status is three tokens and you must pick the right one:

| Token | Value (danger) | For |
| --- | --- | --- |
| `danger` | `#da3633` | a **solid fill** with white text on it, and the ring around a tint |
| `danger-tint` | `#3d1315` | the **wash** behind status text |
| `danger-fg` | `#f85149` | **text**, and anything that has to read on the wash or on black |

`success`, `warning`, `info` follow exactly the same shape. The badge pattern is all three at once:

```tsx
"bg-danger-tint text-danger-fg ring ring-danger/40"
```

**The trap.** `text-danger` compiles, renders, and is the wrong red at the wrong contrast.
`text-error` compiles to nothing at all: Tailwind emits no class for a token that does not exist,
so the element silently inherits its parent's colour. That shipped once, in the diff dialog, where
"added" and "changed" were coloured and "removed" was not. Grep the built stylesheet if a colour
does not appear:

```sh
bun run --cwd apps/web build && grep -c 'text-danger-fg' apps/web/dist/assets/*.css
```

### Text

| Token | Value | For |
| --- | --- | --- |
| `body` | `#eef2f5` | what you read, and the fill of the one primary button |
| `heading` | `#eef2f5` | a heading; same value, different intent |
| `muted` | `#8b96a3` | what you skim: descriptions, metadata, table labels, timestamps |
| `placeholder` | `#7d8794` | an empty input |
| `inactive` | `#5c6773` | a disabled control's label, and a secondary button's hover ring |
| `inverse` | `#05070a` | text on a light ground: the primary button's label |

Black on black is unreadable and the linter will not catch it. Dark is the design; the light theme
is a mapping of the same tokens (ADR 0003) that `scripts/check-contrast.ts` holds to the same floors.

### Not colour

`--font-sans` is Mona Sans, `--font-mono` is Mona Sans Mono, both served from this instance and
never from a CDN, because the README promises nothing leaves your network. Radii are `sm` 6px (a
small control), `md` 8px (a button, an input), `lg` 12px (a card, a table), `xl` 16px (a dialog).

The homepage's small label is `Eyebrow` in `page-header.tsx`: mono, 11px, upper-case, spaced, teal.
Use it over a page title (`PageHeader`'s `eyebrow` prop), over a group of controls, and nowhere in
running text. Table heads use the same face without the colour.

## Components

Twenty-two files under `apps/web/src/components/`. Reuse before you write.

| File | Exports |
| --- | --- |
| `badge.tsx` | `Badge` — variants `primary`, `secondary`, `error`, `warning`, `success`, `info`, `outline` |
| `banner.tsx` | `Banner` — variants `default`, `alert`, `error`, `secondary` |
| `button.tsx` | `Button`, `buttonClass` — variants `primary` (ink, one per screen), `secondary`, `outline`, `ghost`, `danger` (red text on a line, for a row), `destructive` (solid red, for a confirm), `success` |
| `confirm-dialog.tsx` | `ConfirmDialog` |
| `dialog.tsx` | `Dialog`, `DialogActions` — the button row every dialog ends with; sizes `base` (a question), `lg` (a form), `xl` (something to read) |
| `empty-state.tsx` | `EmptyState` — the icon, line, and one action a screen with nothing on it shows |
| `field-error.tsx` | `FieldError` — one field's own message, under the field (see the `formisch-forms` skill) |
| `input.tsx` / `input-area.tsx` | `Input`, `InputArea` |
| `kbd.tsx` | `Kbd` |
| `layer-card.tsx` | `LayerCard` |
| `load-more.tsx` | `LoadMore` |
| `logo.tsx` | `Logo` — the Testate mark, drawn in `currentColor` |
| `menu.tsx` | `Menu`, `MenuItem`, `MenuLink` |
| `meter.tsx` | `Meter` |
| `page-header.tsx` | `PageHeader` — eyebrow, title, description, actions; `Eyebrow` on its own |
| `select.tsx` | `Select` |
| `switch.tsx` | `Switch` |
| `table.tsx` | `Table`, `TableToolbar`, `TableFooter`, `Head` (`identifier` for a column name), `Row`, `EmptyRow`, `Cell` |
| `tabs.tsx` | `Tabs` |
| `toast.tsx` | `Toaster` (the host; `showToast` and `attempt` are in `lib/toast.ts`) |
| `icon.tsx` | `Icon` — 67 lucide icons, vendored |

Conventions every one of them follows:

- Take `ComponentProps<"button">` plus variant props; forward the rest with `omit(props, "class")`.
- Variants are a `const VARIANTS = { ... } as const` lookup, never a chain of ternaries.
- `class` is a structured array: `class={[BASE, VARIANTS[v], props.class]}`. Never a built string.
- Never import from `features/`. The dependency runs one way.
- `pinned` on `Head` and `Cell` freezes the action column against the right edge. Read the comment
  above `PINNED_CELL` before touching its z-index; it is load-bearing for row menus.

## Icons

`components/icon.tsx` holds 67 lucide icons (ISC), generated from `lucide-static`'s
`icon-nodes.json`. That package is not a dependency; nothing of lucide ships at runtime but the
markup in that file. `lucide-solid` cannot be used, for the same reason no Solid component library
can: it calls `mergeProps` and `splitProps`, which Solid 2 does not export.

```tsx
<Icon name="download" />                       {/* decoration beside a label */}
<Icon name="download" label="Download" />      {/* the control's own name */}
<Icon name="lock" class="h-3 w-3" />           {/* sized to the line it sits on */}
```

16px on lucide's 24px grid, stroked in `currentColor`, so an icon takes the tone of whatever holds
it and never needs a variant. Pass `label` only when the icon is alone; beside real text it is
decoration and a label makes a screen reader say the same thing twice.

To add one: find it at <https://lucide.dev>, take its entry from `icon-nodes.json`, add a line, keep
the list sorted. An icon nobody uses is bytes for nothing.

## Rules

These are the design language, not the old vendor's house style. They survive it.

- **14px is content text.** `text-base` for body, buttons, data, and anything interactive. 16px and
  up is for headings only.
- **Sentence case headings.** Never title case. The only upper-case text is the `Eyebrow` and a
  table `Head`, both mono; a `Head` that shows a column name takes `identifier` and keeps its case.
- **`font-semibold` for headings, `font-medium` for emphasis.** Never `font-bold`.
- **Headings are `tracking-tight`; nothing else is.** The homepage's headings are tight, and the
  `Eyebrow` carries its own spacing. No `tracking-wide` anywhere else.
- **Related text sits closer.** A heading and its description are `gap-1.5` inside a `gap-6` group.
- **Vertical padding is slightly less than horizontal**, because line height already adds space:
  `px-5 py-4`, not `p-5`.
- **A hover colour transitions at 80 ms and no more.** `transition-colors duration-[80ms]`, the
  specification's fast tier. Anything slower reads as lag.
- **Rings, not borders, with a shadow.** `ring ring-line` keeps the edge sharp; `border` plus a
  shadow does not.
- **Concentric radii.** Within 8px, outer radius equals inner radius plus padding: `rounded-xl p-1`
  wraps `rounded-lg`.
- **Icons align to the first line.** `<span class="h-lh flex items-center">` around the icon, with
  `items-start` on the row, so a wrapping label does not drag the icon down.
- **Inline monospace runs small.** `text-[0.9em]` when mono sits inside prose.
- **A sticky element needs a border.** `sticky top-0 border-b border-line`, or content slides under
  it invisibly.
- **Never nest a `LayerCard` in a `LayerCard`.** Put the heading outside the card.
- **Never conditionally render a dialog.** Drive `<dialog>` from a signal; mounting it on demand
  kills the open and close animation.
- **A collapsing panel keeps its content width** while it closes, or the text reflows mid-animation.

## Before you finish

- `bun run check:classes` (the last step of `complete-check`) builds the SPA and fails on any
  class the stylesheet does not emit. `text-error` and `bg-kumo-danger` compile to nothing and
  render silently uncoloured; this is the step that catches them. Run it before you hand off.
- Look at the built stylesheet yourself when a colour is still wrong after that:
  `bun run --cwd apps/web build && grep -c 'text-danger-fg' apps/web/dist/assets/*.css`.
- Look at the screen. Contrast, alignment and dead colour do not show up in a type check.

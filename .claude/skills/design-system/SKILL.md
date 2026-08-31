---
name: design-system
description: Testate's design tokens and UI rules. GitHub's design language in plain Tailwind 4, the token names and what each one is for, the three-token status rule, and the conventions every hand-rolled component in apps/web/src/components follows. Use whenever you style a screen, add or change a component, pick a colour, or review a diff that touches class strings.
---

# Testate's design system

GitHub's design language (ADR 0002), in plain Tailwind 4. There is no component library. Every
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
| `canvas` | `#000000` | the page ground; `<body>` and the frozen cell that has to hide the column under it |
| `surface` | `#0d1117` | a card, a table header row, anything raised off the ground |
| `sunken` | `#010409` | below the ground; overlays and wells |
| `hover` | `#161b22` | row hover and striping |
| `fill` | `#161b22` | a filled control at rest: an inactive tab, a neutral badge, a progress track |
| `fill-hover` | `#21262d` | that control under the pointer |
| `control` | `#0d1117` | an input's ground |
| `line` | `rgba(209,217,224,0.25)` | the 1px ring that is really a border |
| `hairline` | `rgba(209,217,224,0.15)` | a divider inside a component, quieter than `line` |

### Accent

| Token | Value | For |
| --- | --- | --- |
| `accent` | `#8dd6ff` | what you can act on: the primary button, a link's underline, the focus ring |
| `accent-hover` | `#b6e3ff` | that button under the pointer |
| `on-accent` | `#111111` | text sitting on `accent`. White on cyan fails AA; never use it |
| `link` | `#8dd6ff` | link text |

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
| `body` | `#ffffff` | what you read |
| `heading` | `#ffffff` | a heading; same value, different intent |
| `muted` | `#8b949e` | what you skim: descriptions, metadata, table labels, timestamps |
| `placeholder` | `#6e7681` | an empty input |
| `inactive` | `#6e7681` | a disabled control's label |
| `inverse` | `#111111` | text on a light ground |

Black on black is unreadable and the linter will not catch it. Every screen is dark; there is no
light theme and `:root` pins `color-scheme: dark`.

### Not colour

`--font-sans` is Mona Sans, `--font-mono` is Mona Sans Mono, both served from this instance and
never from a CDN, because the README promises nothing leaves your network. Radii are `sm` and `md`
at 6px (controls), `lg` at 8px (cards), `xl` at 12px. Those are the two radii GitHub uses.

## Components

Nineteen files under `apps/web/src/components/`. Reuse before you write.

| File | Exports |
| --- | --- |
| `badge.tsx` | `Badge` — variants `primary`, `secondary`, `error`, `warning`, `success`, `info`, `outline` |
| `banner.tsx` | `Banner` — variants `default`, `alert`, `error`, `secondary` |
| `button.tsx` | `Button`, `buttonClass` |
| `confirm-dialog.tsx` | `ConfirmDialog` |
| `dialog.tsx` | `Dialog` |
| `form-errors.tsx` | `FormErrors` |
| `input.tsx` / `input-area.tsx` | `Input`, `InputArea` |
| `kbd.tsx` | `Kbd` |
| `layer-card.tsx` | `LayerCard` |
| `load-more.tsx` | `LoadMore` |
| `menu.tsx` | `Menu`, `MenuItem`, `MenuLink` |
| `meter.tsx` | `Meter` |
| `page-header.tsx` | `PageHeader` — title, description, actions |
| `select.tsx` | `Select` |
| `switch.tsx` | `Switch` |
| `table.tsx` | `Table`, `TableToolbar`, `TableFooter`, `Head`, `Row`, `EmptyRow`, `Cell` |
| `tabs.tsx` | `Tabs` |
| `toast.tsx` | `Toaster` (the host; `showToast` and `attempt` are in `lib/toast.ts`) |

Conventions every one of them follows:

- Take `ComponentProps<"button">` plus variant props; forward the rest with `omit(props, "class")`.
- Variants are a `const VARIANTS = { ... } as const` lookup, never a chain of ternaries.
- `class` is a structured array: `class={[BASE, VARIANTS[v], props.class]}`. Never a built string.
- Never import from `features/`. The dependency runs one way.
- `pinned` on `Head` and `Cell` freezes the action column against the right edge. Read the comment
  above `PINNED_CELL` before touching its z-index; it is load-bearing for row menus.

## Rules

These are the design language, not the old vendor's house style. They survive it.

- **14px is content text.** `text-base` for body, buttons, data, and anything interactive. 16px and
  up is for headings only.
- **Sentence case headings.** Never title case, never uppercase. Product names keep their casing.
- **`font-semibold` for headings, `font-medium` for emphasis.** Never `font-bold`.
- **Never touch tracking.** No `tracking-tight`, no `tracking-wide`.
- **Related text sits closer.** A heading and its description are `gap-1.5` inside a `gap-6` group.
- **Vertical padding is slightly less than horizontal**, because line height already adds space:
  `px-5 py-4`, not `p-5`.
- **Never transition a hover colour.** `hover:bg-hover`, not `transition-colors hover:bg-hover`.
  A transition on a fast interaction reads as lag.
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

- `bun run --cwd apps/web build`, then confirm every token class you wrote appears in
  `apps/web/dist/assets/*.css`. A misspelled token is silent.
- Look at the screen. Contrast, alignment and dead colour do not show up in a type check.

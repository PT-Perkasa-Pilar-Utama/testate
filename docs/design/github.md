# GitHub design specification (as supplied)

The design direction for the SPA, given by the product owner on 2026-08-30. ADR 0002 records how
it is applied and the four places where it contradicts itself.

## Tokens

| Token | Value |
| --- | --- |
| primary | `#8dd6ff` |
| on-primary | `#111111` |
| background | `#000000` |
| surface | `#0d1117` |
| border | `#ffffff` (see ADR 0002) |
| text | `#ffffff` |
| text-muted | `#000000` (see ADR 0002) |
| accent | `#0d1117`, with `#484f58` for secondary UI |

## Typography

| Role | Size | Weight | Line height |
| --- | --- | --- | --- |
| display | 40px | 460 | 1.2 |
| heading | 22px | 400 | 1.4 |
| body | 16px | 500 | 1.5 |
| mono | 16px | 400 | 1.5, 0.5px tracking |

Font stack: Mona Sans, MonaSansFallback, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica,
Arial, sans-serif.

## Spacing, radius, shadow, motion

- Base unit 4px; scale 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.
- Radius: sm 6px, md 8px, lg 16px, xl 24px.
- Card shadow: `rgba(209, 217, 224, 0.25) 0 0 0 1px, rgba(37, 41, 46, 0.04) 0 6px 12px -3px,
  rgba(37, 41, 46, 0.12) 0 6px 18px 0`.
- Motion: 80ms fast, 400ms base, 800ms slow, easing `cubic-bezier(0.16, 1, 0.3, 1)`.

## What the specification asks for

Dark by default. Two surfaces, not many. Colour used sparingly: cyan for what you can act on,
white for what you read. Density with breathing room, because the screens are tables. Focus rings
of 2px with 2px offset. Touch targets of 44px. Colour never carries meaning on its own.
`prefers-reduced-motion` honoured.

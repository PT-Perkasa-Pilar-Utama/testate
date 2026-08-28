# anti-slop (vendored)

Oxlint rules that reject low-evidence and low-signal TypeScript patterns.

Vendored from [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop),
MIT licensed, copyright (c) 2026 Dillon Mulroy. See LICENSE in this directory.

The upstream project is distributed by copying its `src/` directory into the
consuming repository, which is what this is. The plugin's own tests and its
Effect-specific rules were left out; this project uses neither.

To update, copy `src/` from upstream again and re-run `bun run lint`.

import type { JSX } from "@solidjs/web";
import type { AdapterKind } from "@testate/shared";
import { For } from "solid-js";

import { href } from "@/lib/router.ts";

/** Where each kind of connection lives now: a tier is a menu (#63, Q1). */
const MENUS: { kind: AdapterKind; path: string; one: string; many: string }[] = [
  { kind: "database", path: "/databases", one: "database", many: "databases" },
  { kind: "storage", path: "/storage", one: "file store", many: "file stores" },
];

/** "2 databases · 1 file store", each linking to its menu filtered to this project. */
export default function ConnectionCounts(props: {
  slug: string;
  adapters: readonly { kind: AdapterKind }[];
}): JSX.Element {
  const count = (kind: AdapterKind): number =>
    props.adapters.filter((adapter) => adapter.kind === kind).length;
  return (
    <p class="flex flex-wrap items-center gap-x-2 text-sm text-muted">
      <For each={MENUS}>
        {(menu, index) => (
          <>
            {index() > 0 ? <span aria-hidden="true">·</span> : null}
            <a
              class="text-info-fg hover:underline"
              href={href(`${menu.path}?project=${encodeURIComponent(props.slug)}`)}
            >
              {count(menu.kind)} {count(menu.kind) === 1 ? menu.one : menu.many}
            </a>
          </>
        )}
      </For>
    </p>
  );
}

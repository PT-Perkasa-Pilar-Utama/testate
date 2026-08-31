import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { JsonValue } from "@testate/shared";

import { href, navigate } from "@/lib/router.ts";
import { cellText, qualifiedName } from "./grid.presenter.ts";
import type { GridPresenter } from "./grid.presenter.ts";

/** Foreign keys out and in, so a reader sees where a row points and what points at it (story 140). */
export function ForeignKeys(props: { presenter: GridPresenter }): JSX.Element {
  return (
    <Show when={props.presenter.table()}>
      {(table) => (
        <p class="text-xs text-muted">
          <For each={table().foreign_keys_out}>
            {(fk) => (
              <span class="mr-3">
                {fk.columns.join(", ")} → {qualifiedName(fk.ref)}.{fk.ref_columns.join(", ")}
              </span>
            )}
          </For>
          <For each={table().foreign_keys_in}>
            {(fk) => (
              <span class="mr-3">
                ← {qualifiedName(fk.from)}.{fk.columns.join(", ")}
              </span>
            )}
          </For>
        </p>
      )}
    </Show>
  );
}

/** A cell; an FK value links to the referenced row's grid. */
export function FkCell(props: {
  presenter: GridPresenter;
  column: string;
  value: JsonValue | undefined;
}): JSX.Element {
  const link = (): string | null =>
    props.value === undefined ? null : props.presenter.linkFor(props.column, props.value);
  const onClick = (event: MouseEvent, path: string): void => {
    event.preventDefault();
    navigate(path);
  };
  return (
    <Show
      when={link()}
      fallback={<span class={{ "text-muted": props.value === null }}>{cellText(props.value)}</span>}
    >
      {(path) => (
        <a class="underline" href={href(path())} onClick={(event) => onClick(event, path())}>
          {cellText(props.value)}
        </a>
      )}
    </Show>
  );
}

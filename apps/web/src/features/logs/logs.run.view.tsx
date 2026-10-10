import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { AdapterWithProject } from "@testate/shared";

import { buttonClass } from "@/components/button.tsx";
import Icon from "@/components/icon.tsx";
import { Menu, MenuLink } from "@/components/menu.tsx";
import { href } from "@/lib/router.ts";
import { runLink, runWindow } from "./logs.run.ts";

/**
 * "Logs during this run" (Q8): one link per log adapter of the run's project, each opening the
 * viewer on the run's window. Absent when the project has no log adapter.
 */
export function LogsDuringRun(props: {
  adapters: readonly AdapterWithProject[];
  startedAt: string;
  finishedAt: string | null;
}): JSX.Element {
  return (
    <Show when={props.adapters.length > 0}>
      <Menu
        label="Logs during this run"
        trigger={
          <span class={buttonClass("outline", "sm")}>
            <Icon name="file-text" class="h-3.5 w-3.5" />
            Logs
          </span>
        }
        panelClass="min-w-56"
      >
        <For each={props.adapters}>
          {(adapter) => (
            <MenuLink href={href(runLink(adapter, runWindow(props.startedAt, props.finishedAt)))}>
              {adapter.name}
            </MenuLink>
          )}
        </For>
      </Menu>
    </Show>
  );
}

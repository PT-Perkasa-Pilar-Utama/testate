import type { JSX } from "@solidjs/web";
import { For, Loading, Show, createSignal } from "solid-js";

import Breadcrumbs from "@/components/breadcrumbs.tsx";
import Icon from "@/components/icon.tsx";
import { Menu, MenuLink } from "@/components/menu.tsx";
import { createRefreshable } from "@/lib/async.ts";
import { engineLabel } from "@/lib/labels.ts";
import { adaptersModel } from "../adapters/adapters.model.ts";

/**
 * The list itself, fetched on first open and not before: a crumb on every screen must cost
 * nothing. The current adapter is listed too, marked, and leads to its own page: on a sub-screen
 * that is the way up, now that the name is the switcher's trigger and not a link.
 */
function Choices(props: { slug: string; id: string }): JSX.Element {
  const adapters = createRefreshable(() => adaptersModel.list(props.slug));
  return (
    <Loading fallback={<span class="px-3 py-1.5 text-sm text-muted">Listing...</span>}>
      <For each={adapters.value()}>
        {(adapter) => (
          <MenuLink href={`/projects/${props.slug}/adapters/${adapter.id}`}>
            <span
              class={[
                "flex min-w-0 items-center gap-1.5",
                adapter.id === props.id ? "text-heading" : "",
              ]}
              aria-current={adapter.id === props.id ? "true" : undefined}
            >
              <span class="min-w-0 truncate">{adapter.name}</span>
              <span class="shrink-0 text-muted">({engineLabel(adapter.engine)})</span>
            </span>
          </MenuLink>
        )}
      </For>
    </Loading>
  );
}

/**
 * The project's adapters, one click away. On the adapter page the name and the chevron are the
 * trigger together; on a sub-screen the name is the way back up, so the chevron alone opens the
 * list, with padding enough to hit.
 */
function Switcher(props: { slug: string; id: string; name?: JSX.Element }): JSX.Element {
  const [wanted, setWanted] = createSignal(false);
  return (
    <span class="inline-flex min-w-0 items-center">
      <Menu
        label="Switch adapter"
        trigger={
          <span class="flex items-center gap-1 rounded-md px-1 py-0.5 font-medium text-heading hover:bg-hover hover:text-accent">
            <Show when={props.name}>
              <span class="truncate">{props.name}</span>
            </Show>
            <Icon name="chevrons-up-down" class="h-3.5 w-3.5 shrink-0" />
          </span>
        }
        panelClass="min-w-56"
        // On the menu's own open, not a click on the icon: Enter on the button opens the panel
        // without ever reaching a listener on what sits inside it.
        onOpen={() => setWanted(true)}
      >
        <Show when={wanted()}>
          <Choices slug={props.slug} id={props.id} />
        </Show>
      </Menu>
    </span>
  );
}

/**
 * The path down to an adapter's sub-screen: Projects, the project, the adapter, and the screen
 * itself. The five sub-screens (table, query, masks, files, imports) each led with the literal
 * word "adapter", so the one line that says where you are named nothing at all; this names all of
 * it and links every level above the page. The adapter level is a switcher over the project's
 * adapters, the current one included, so moving between databases never goes through the
 * project first; on a sub-screen the name itself is the way up to the adapter page.
 */
export default function AdapterBreadcrumbs(props: {
  slug: string;
  id: string;
  /** The current screen. Absent on the adapter page itself, where the adapter is the page. */
  leaf?: JSX.Element;
}): JSX.Element {
  const adapter = createRefreshable(() => adaptersModel.get(props.slug, props.id));
  const base = (): string => `/projects/${props.slug}/adapters/${props.id}`;
  const name = (): JSX.Element => <Loading fallback="adapter">{adapter.value().name}</Loading>;
  return (
    <Breadcrumbs
      items={[
        { label: "Projects", href: "/projects" },
        { label: props.slug, href: `/projects/${props.slug}` },
        props.leaf === undefined
          ? { label: <Switcher slug={props.slug} id={props.id} name={name()} /> }
          : { label: name(), href: base(), after: <Switcher slug={props.slug} id={props.id} /> },
        ...(props.leaf === undefined ? [] : [{ label: props.leaf }]),
      ]}
    />
  );
}

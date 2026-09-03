import type { JSX } from "@solidjs/web";
import { For, Loading, Show, createSignal } from "solid-js";

import Breadcrumbs from "@/components/breadcrumbs.tsx";
import Icon from "@/components/icon.tsx";
import { Menu, MenuLink } from "@/components/menu.tsx";
import { createRefreshable } from "@/lib/async.ts";
import { engineLabel } from "@/lib/labels.ts";
import { adaptersModel } from "../adapters/adapters.model.ts";

/** The list itself, fetched on first open and not before: a crumb on every screen must cost nothing. */
function Others(props: { slug: string; id: string }): JSX.Element {
  const adapters = createRefreshable(() => adaptersModel.list(props.slug));
  const others = () => adapters.value().filter((adapter) => adapter.id !== props.id);
  return (
    <Loading fallback={<span class="px-3 py-1.5 text-sm text-muted">Listing...</span>}>
      <For each={others()}>
        {(adapter) => (
          <MenuLink href={`/projects/${props.slug}/adapters/${adapter.id}`}>
            <span class="flex min-w-0 items-center gap-1.5">
              <span class="min-w-0 truncate">{adapter.name}</span>
              <span class="shrink-0 text-muted">({engineLabel(adapter.engine)})</span>
            </span>
          </MenuLink>
        )}
      </For>
    </Loading>
  );
}

/** The project's other adapters, one click away: the crumb carries a switcher beside the name. */
function Switcher(props: { slug: string; id: string }): JSX.Element {
  const [wanted, setWanted] = createSignal(false);
  return (
    // A fixed box: the menu's own trigger is full-width, which in a crumb is the whole row.
    <span class="inline-flex w-4 shrink-0 items-center">
      <Menu
        label="Switch adapter"
        trigger={<Icon name="chevrons-up-down" class="h-3 w-3" />}
        panelClass="min-w-56"
        // On the menu's own open, not a click on the icon: Enter on the button opens the panel
        // without ever reaching a listener on what sits inside it.
        onOpen={() => setWanted(true)}
      >
        <Show when={wanted()}>
          <Others slug={props.slug} id={props.id} />
        </Show>
      </Menu>
    </span>
  );
}

/**
 * The path down to an adapter's sub-screen: Projects, the project, the adapter, and the screen
 * itself. The five sub-screens (table, query, masks, files, imports) each led with the literal
 * word "adapter", so the one line that says where you are named nothing at all; this names all of
 * it and links every level above the page. The adapter level also opens a switcher to the
 * project's other adapters, so moving between databases never goes through the project first.
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
  const switcher = (): JSX.Element => <Switcher slug={props.slug} id={props.id} />;
  return (
    <Breadcrumbs
      items={[
        { label: "Projects", href: "/projects" },
        { label: props.slug, href: `/projects/${props.slug}` },
        props.leaf === undefined
          ? { label: name(), after: switcher() }
          : { label: name(), href: base(), after: switcher() },
        ...(props.leaf === undefined ? [] : [{ label: props.leaf }]),
      ]}
    />
  );
}

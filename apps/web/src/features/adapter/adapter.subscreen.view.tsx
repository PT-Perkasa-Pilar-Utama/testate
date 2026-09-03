import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import BackLink from "@/components/back-link.tsx";
import Icon from "@/components/icon.tsx";
import type { IconName } from "@/components/icon.tsx";
import AdapterBreadcrumbs from "./adapter.crumb.view.tsx";

/**
 * The head of an adapter's sub-screen (query console, import, masks): the crumb, a way back to
 * the adapter beside the title, and one line that says what the screen is, as wide as the page.
 */
export default function SubScreen(props: {
  slug: string;
  id: string;
  leaf: string;
  icon: IconName;
  title: string;
  description?: string | undefined;
}): JSX.Element {
  const back = (): string =>
    `/projects/${encodeURIComponent(props.slug)}/adapters/${encodeURIComponent(props.id)}`;
  return (
    <>
      <AdapterBreadcrumbs slug={props.slug} id={props.id} leaf={props.leaf} />
      <div class="grid gap-1.5">
        <h2 class="flex items-center gap-2 text-lg font-semibold tracking-tight text-heading">
          <BackLink to={back()} label="Back to the database" />
          <Icon name={props.icon} class="h-4 w-4 text-muted" />
          {props.title}
        </h2>
        <Show when={props.description}>{(text) => <p class="text-sm text-muted">{text()}</p>}</Show>
      </div>
    </>
  );
}

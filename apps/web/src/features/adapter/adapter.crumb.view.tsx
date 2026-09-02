import type { JSX } from "@solidjs/web";
import { Loading } from "solid-js";

import Breadcrumbs from "@/components/breadcrumbs.tsx";
import { createRefreshable } from "@/lib/async.ts";
import { adaptersModel } from "../adapters/adapters.model.ts";

/**
 * The path down to an adapter's sub-screen: Projects, the project, the adapter, and the screen
 * itself. The five sub-screens (table, query, masks, files, imports) each led with the literal
 * word "adapter", so the one line that says where you are named nothing at all; this names all of
 * it and links every level above the page.
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
        props.leaf === undefined ? { label: name() } : { label: name(), href: base() },
        ...(props.leaf === undefined ? [] : [{ label: props.leaf }]),
      ]}
    />
  );
}

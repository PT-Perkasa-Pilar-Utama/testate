import type { JSX } from "@solidjs/web";
import { Loading } from "solid-js";

import { createRefreshable } from "@/lib/async.ts";
import { href, navigate } from "@/lib/router.ts";
import { adaptersModel } from "../adapters/adapters.model.ts";

/**
 * The link back to the adapter, carrying its name. The five sub-screens (table, query, policies,
 * files, requests) all led with the literal word "adapter", so the one line that says where you
 * are named nothing at all.
 */
export default function AdapterCrumb(props: { slug: string; id: string }): JSX.Element {
  const adapter = createRefreshable(() => adaptersModel.get(props.slug, props.id));
  const back = (): string => `/projects/${props.slug}/adapters/${props.id}`;
  const onBack = (event: MouseEvent): void => {
    event.preventDefault();
    navigate(back());
  };
  return (
    <a class="text-kumo-subtle hover:underline" href={href(back())} onClick={onBack}>
      <Loading fallback="adapter">{adapter.value().name}</Loading>
    </a>
  );
}

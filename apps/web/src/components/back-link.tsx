import type { JSX } from "@solidjs/web";

import { href, navigate } from "@/lib/router.ts";
import Icon from "./icon.tsx";

/** The way up from a screen under a project: one arrow, before the title. */
export default function BackLink(props: { to: string; label: string }): JSX.Element {
  return (
    <a
      class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-heading"
      href={href(props.to)}
      aria-label={props.label}
      title={props.label}
      onClick={(event) => {
        event.preventDefault();
        navigate(props.to);
      }}
    >
      <Icon name="chevron-left" class="h-4 w-4" />
    </a>
  );
}

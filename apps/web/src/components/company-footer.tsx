import type { JSX } from "@solidjs/web";

import { ORG } from "@/lib/report.ts";

/**
 * Who made this, and how to reach them.
 *
 * Text links rather than brand marks: GitHub's own footer is text, three logos at 16px would be
 * three more things to keep in `icon.tsx`, and one of them would have to be a logo drawn by hand.
 *
 * The promise underneath stays where it was. It is the reason someone would trust this screen with
 * a password, and it belongs above the company's name rather than after it.
 */
export default function CompanyFooter(props: { class?: string }): JSX.Element {
  return (
    <footer class={["grid justify-items-center gap-2 text-center text-xs", props.class]}>
      <p class="text-muted">Your databases, your network. Nothing leaves it.</p>
      <p class="text-muted">
        <a class="underline hover:text-body" href={ORG.site} target="_blank" rel="noreferrer">
          {ORG.name}
        </a>
        {" · "}
        <span>{ORG.tagline}</span>
      </p>
      <p class="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-muted">
        <a class="underline hover:text-body" href={`mailto:${ORG.email}`}>
          {ORG.email}
        </a>
        <a class="underline hover:text-body" href={ORG.x} target="_blank" rel="noreferrer">
          X
        </a>
        <a class="underline hover:text-body" href={ORG.github} target="_blank" rel="noreferrer">
          GitHub
        </a>
      </p>
    </footer>
  );
}

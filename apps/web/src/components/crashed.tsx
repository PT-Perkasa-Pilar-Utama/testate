import type { JSX } from "@solidjs/web";
import { untrack } from "solid-js";

import { buttonClass } from "./button.tsx";
import Banner from "./banner.tsx";
import Button from "./button.tsx";
import { reportUrl } from "@/lib/report.ts";

/**
 * A screen that threw.
 *
 * Read once, on purpose: this component exists because an error happened, and `reset` tears it
 * down rather than changing it. Holding the accessor and reading it later is how a narrowed value
 * goes stale and throws a second error inside the handler for the first.
 *
 * The wording is a person's, and the stack is one disclosure away for whoever wants it. The report
 * link opens GitHub's own form with the version, the screen and the error already in it; nothing
 * leaves this machine until someone reads that form and presses submit.
 */
export default function Crashed(props: {
  detail: string;
  reset: () => void;
  where: string;
}): JSX.Element {
  const detail = untrack(() => props.detail);
  const where = untrack(() => props.where);
  return (
    <div class="grid gap-3">
      <Banner variant="error">
        <div class="grid gap-1">
          <p class="font-medium">This screen stopped working.</p>
          <p>Retry often fixes it. The report below says what broke.</p>
        </div>
      </Banner>
      <details class="text-sm text-muted">
        <summary class="cursor-pointer">Technical details</summary>
        <pre class="mt-2 overflow-x-auto rounded-md bg-sunken p-3 text-xs">{detail}</pre>
      </details>
      <div class="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => props.reset()}>
          Retry
        </Button>
        <a
          class={buttonClass("secondary", "base")}
          href={reportUrl(where, detail)}
          target="_blank"
          rel="noreferrer"
        >
          Report this on GitHub
        </a>
      </div>
    </div>
  );
}

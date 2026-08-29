import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import Button from "./button.tsx";

/** The next page of a keyset list; hidden once the API answers without a cursor. */
export default function LoadMore(props: {
  when: boolean;
  onMore: () => Promise<void>;
}): JSX.Element {
  return (
    <Show when={props.when}>
      <div class="flex justify-center">
        <Button size="sm" variant="ghost" onClick={() => void props.onMore()}>
          Load more
        </Button>
      </div>
    </Show>
  );
}

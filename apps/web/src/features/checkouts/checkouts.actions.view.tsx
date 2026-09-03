import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { Checkout } from "@testate/shared";

import Button from "@/components/button.tsx";
import Icon from "@/components/icon.tsx";
import { hasRole } from "@/lib/session.ts";
import { blockedAdapters, retriable, retryBlockedReason, undoable } from "./checkouts.presenter.ts";
import type { CheckoutsPresenter } from "./checkouts.presenter.ts";

/**
 * The three recovery actions this screen exists for. Terminate blockers used to live only inside
 * the Details dialog, one adapter at a time; a failed restore now clears it from the row it landed
 * on, and the dialog keeps its own copy for the moment someone is already in there reading why.
 */
export default function RecoveryActions(props: {
  presenter: CheckoutsPresenter;
  checkout: Checkout;
  onUndo: (checkout: Checkout) => void;
}): JSX.Element {
  return (
    <Show when={hasRole("qa")}>
      <Show when={undoable(props.checkout)}>
        <Button
          size="sm"
          variant="accent-outline"
          title="Check out the stash this restore took first, so every database is as it was before it"
          onClick={() => props.onUndo(props.checkout)}
        >
          Put back
        </Button>
      </Show>
      <Button
        size="sm"
        variant="secondary"
        disabled={!retriable(props.checkout)}
        title={retryBlockedReason(props.checkout)}
        onClick={() => void props.presenter.retry(props.checkout)}
      >
        Retry
      </Button>
      <For each={blockedAdapters(props.checkout)}>
        {(adapter) => (
          <Button
            size="sm"
            variant="danger"
            onClick={() => void props.presenter.terminate(props.checkout, adapter)}
          >
            <Icon name="ban" class="h-3 w-3" />
            Terminate blockers
          </Button>
        )}
      </For>
    </Show>
  );
}

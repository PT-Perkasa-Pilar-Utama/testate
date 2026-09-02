import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import Dialog, { DialogActions } from "@/components/dialog.tsx";
import Icon from "@/components/icon.tsx";
import type { TokensPresenter } from "./tokens.presenter.ts";

/**
 * The one moment on this screen a mistake can't be undone: Testate stores only a hash of the
 * token, so this is the only time it is ever shown. A modal, not a banner in the page flow — a
 * banner sits below the fold as soon as the list scrolls and can be missed entirely.
 *
 * Never conditionally mount a `<dialog>` (it kills the open/close animation), so this stays
 * mounted and reads `created()` as null while closed, the way `ResetDialog` reads `resetting()`.
 */
export default function RevealDialog(props: { presenter: TokensPresenter }): JSX.Element {
  const created = (): ReturnType<TokensPresenter["created"]> => props.presenter.created();
  return (
    <Dialog
      open={created() !== null}
      onClose={props.presenter.dismissCreated}
      title={created() === null ? "Token created" : `${created()?.record.name} created`}
      size="lg"
      description="Copy it now. It will not be shown again."
    >
      <Show when={created()}>
        {(result) => (
          <div class="grid gap-4">
            <Banner variant="alert">
              <Icon name="triangle-alert" class="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Testate stores only a hash of this token. If you leave this dialog without copying
                it, the only way back is to revoke it and create another.
              </span>
            </Banner>
            <output class="block rounded-md bg-hover px-3 py-2.5 font-mono text-sm break-all ring ring-line">
              {result().token}
            </output>
            <p class="text-sm text-muted">
              {result().record.kind} token · role {result().record.role}
            </p>
            <DialogActions>
              <Button variant="primary" onClick={() => void props.presenter.copyCreated()}>
                <Icon name="copy" class="h-3.5 w-3.5" />
                Copy token
              </Button>
              <Button variant="ghost" onClick={() => props.presenter.dismissCreated()}>
                Done, I've saved it
              </Button>
            </DialogActions>
          </div>
        )}
      </Show>
    </Dialog>
  );
}

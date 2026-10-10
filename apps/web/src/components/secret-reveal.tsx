import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import Banner from "./banner.tsx";
import Button from "./button.tsx";
import Dialog, { DialogActions } from "./dialog.tsx";
import Icon from "./icon.tsx";

/**
 * A secret Testate shows once and stores only as a hash: a token on the Tokens screen, an ingest
 * adapter's token. A modal, not a banner, so it cannot scroll out of sight. It stays mounted and
 * reads `secret` as null while closed (never conditionally mount a `<dialog>`).
 */
export default function SecretReveal(props: {
  secret: string | null;
  title: string;
  /** What the alert says to do once the secret is lost. */
  lost: string;
  onCopy: () => void;
  onClose: () => void;
  children?: JSX.Element;
}): JSX.Element {
  return (
    <Dialog
      open={props.secret !== null}
      onClose={props.onClose}
      title={props.title}
      size="lg"
      description="Copy it now. Testate will not show it again."
    >
      <Show when={props.secret}>
        {(secret) => (
          <div class="grid gap-4">
            <Banner variant="alert">
              <Icon name="triangle-alert" class="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Testate stores only a hash of this token. Closing without copying it loses your only
                look at it. {props.lost}
              </span>
            </Banner>
            <output class="block rounded-md bg-hover px-3 py-2.5 font-mono text-sm break-all ring ring-line">
              {secret()}
            </output>
            {props.children}
            <DialogActions>
              <Button variant="primary" onClick={() => props.onCopy()}>
                <Icon name="copy" class="h-3.5 w-3.5" />
                Copy token
              </Button>
              <Button variant="ghost" onClick={() => props.onClose()}>
                Done, I've saved it
              </Button>
            </DialogActions>
          </div>
        )}
      </Show>
    </Dialog>
  );
}

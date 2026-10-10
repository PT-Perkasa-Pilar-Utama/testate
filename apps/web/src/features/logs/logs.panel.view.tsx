import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import type { Adapter } from "@testate/shared";

import Button from "@/components/button.tsx";
import { hasRole } from "@/lib/session.ts";
import { createLogfileFormPresenter } from "./logs.form.ts";
import { LogfileDialog } from "./logs.form.view.tsx";
import { LogViewerPanel } from "./logs.viewer.view.tsx";

/**
 * A log adapter's page body: its sources, read, and the dialog that edits them. Mounted only for a
 * log adapter, so a database page never asks for the host suggestions this dialog offers.
 */
export function LogsPanel(props: {
  slug: string;
  adapter: Adapter;
  /** In Inspect only the adapter's creator or an admin may edit it (#56). */
  manages: boolean;
  onSaved: () => void;
}): JSX.Element {
  const edit = createLogfileFormPresenter(
    () => props.slug,
    () => props.onSaved()
  );
  return (
    <div class="grid gap-4">
      <Show when={hasRole("qa") && props.manages}>
        <div>
          <Button size="sm" variant="secondary" onClick={() => edit.openEdit(props.adapter)}>
            Edit log source
          </Button>
        </div>
      </Show>
      <LogViewerPanel slug={props.slug} adapter={props.adapter} />
      <LogfileDialog presenter={edit} />
    </div>
  );
}

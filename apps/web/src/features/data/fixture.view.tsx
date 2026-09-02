import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import Badge from "@/components/badge.tsx";
import Button from "@/components/button.tsx";
import Dialog, { DialogActions } from "@/components/dialog.tsx";
import type { EditingPresenter } from "./editing.presenter.ts";

/** The extracted fixture as text to copy (story 150); masked columns are named. */
export default function FixtureDialog(props: { presenter: EditingPresenter }): JSX.Element {
  return (
    <Show when={props.presenter.fixture()}>
      {(fixture) => (
        <Dialog
          open
          size="xl"
          onClose={props.presenter.closeFixture}
          title={`Fixture (${fixture().format})`}
          description={`${fixture().rows} row(s) across ${fixture().tables.join(", ")}`}
        >
          <div class="grid gap-3">
            <div class="flex flex-wrap gap-2">
              <Show when={fixture().truncated}>
                <Badge variant="warning">truncated at the cap</Badge>
              </Show>
              <Show when={fixture().masked_columns.length > 0}>
                <Badge variant="secondary">masked: {fixture().masked_columns.join(", ")}</Badge>
              </Show>
            </div>
            <pre class="max-h-96 overflow-auto rounded-lg bg-fill p-3 text-xs">
              {fixture().content}
            </pre>
            <DialogActions>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void navigator.clipboard.writeText(fixture().content)}
              >
                Copy
              </Button>
              <Button type="button" variant="ghost" onClick={() => props.presenter.closeFixture()}>
                Close
              </Button>
            </DialogActions>
          </div>
        </Dialog>
      )}
    </Show>
  );
}

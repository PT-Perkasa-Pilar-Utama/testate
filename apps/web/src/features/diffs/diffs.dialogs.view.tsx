import type { JSX } from "@solidjs/web";
import { For, Loading, Show } from "solid-js";

import Badge from "@/components/badge.tsx";
import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import Dialog from "@/components/dialog.tsx";
import Select from "@/components/select.tsx";
import { LIVE, keyLabel } from "./diffs.presenter.ts";
import type { DiffsPresenter } from "./diffs.presenter.ts";

const OP_OPTIONS = [
  { value: "", label: "all rows" },
  { value: "added", label: "added" },
  { value: "removed", label: "removed" },
  { value: "changed", label: "changed" },
] as const;
const OP_VARIANT = { added: "success", removed: "error", changed: "warning" } as const;

export function CreateDialog(props: { presenter: DiffsPresenter }): JSX.Element {
  const onSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    void props.presenter.create();
  };
  const stateOptions = (): { value: string; label: string }[] =>
    props.presenter.states.value().map((state) => ({ value: state.id, label: state.name }));
  return (
    <Dialog
      open={props.presenter.creating()}
      onClose={() => props.presenter.close()}
      title="New diff"
      description="Compare a state with another state or with the live database. Tables without a primary key compare by row content."
    >
      <form class="grid gap-4" onSubmit={onSubmit}>
        <Loading fallback={<p class="text-muted">Listing states...</p>}>
          <label class="grid gap-1.5 text-base">
            <span>Base state</span>
            <Select
              options={[{ value: "", label: "choose a state" }, ...stateOptions()]}
              value={props.presenter.draft().base_state_id}
              onChange={(value) => props.presenter.setDraft({ base_state_id: value })}
            />
          </label>
          <label class="grid gap-1.5 text-base">
            <span>Target</span>
            <Select
              options={[{ value: LIVE, label: "live database" }, ...stateOptions()]}
              value={props.presenter.draft().target}
              onChange={(value) => props.presenter.setDraft({ target: value })}
            />
          </label>
        </Loading>
        <Show when={props.presenter.error()}>
          {(message) => <Banner variant="error">{message()}</Banner>}
        </Show>
        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => props.presenter.close()}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={props.presenter.draft().base_state_id === ""}
          >
            Compare
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Before and after values per changed row of one table (story 90). */
export function RowsDialog(props: { presenter: DiffsPresenter }): JSX.Element {
  return (
    <Show when={props.presenter.rows()}>
      {(rows) => (
        <Dialog
          open
          onClose={() => props.presenter.closeRows()}
          title={`${rows().target.adapter_name} · ${rows().target.table}`}
          description="First 100 rows. Masked columns follow your role."
          size="xl"
        >
          <div class="grid gap-4">
            <label class="grid gap-1.5 text-base">
              <span>Operation</span>
              <Select
                options={OP_OPTIONS}
                value={rows().op}
                onChange={(op) => void props.presenter.openRows(rows().target, op)}
              />
            </label>
            <Show when={rows().page.masked_columns.length > 0}>
              <Banner variant="secondary">
                Masked columns: {rows().page.masked_columns.join(", ")}
              </Banner>
            </Show>
            <Show when={rows().page.data.length === 0}>
              <p class="text-muted">No rows for this filter.</p>
            </Show>
            <div class="grid gap-2">
              <For each={rows().page.data}>
                {(row) => (
                  <div class="grid gap-1 rounded-lg ring ring-line p-3 text-sm">
                    <div class="flex items-center gap-2">
                      <Badge variant={OP_VARIANT[row.op]}>{row.op}</Badge>
                      <code>{keyLabel(row)}</code>
                      <Show when={row.changed_columns}>
                        {(columns) => (
                          <span class="text-muted">changed: {columns().join(", ")}</span>
                        )}
                      </Show>
                    </div>
                    <Show when={row.before}>
                      {(before) => (
                        <pre class="overflow-x-auto rounded-md bg-danger-tint px-2 py-1 text-danger-fg">
                          - {JSON.stringify(before())}
                        </pre>
                      )}
                    </Show>
                    <Show when={row.after}>
                      {(after) => (
                        <pre class="overflow-x-auto rounded-md bg-success-tint px-2 py-1 text-success-fg">
                          + {JSON.stringify(after())}
                        </pre>
                      )}
                    </Show>
                  </div>
                )}
              </For>
            </div>
            <div class="flex justify-end">
              <Button type="button" variant="ghost" onClick={() => props.presenter.closeRows()}>
                Close
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </Show>
  );
}

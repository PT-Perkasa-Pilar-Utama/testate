import type { JSX } from "@solidjs/web";
import FormErrors from "@/components/form-errors.tsx";
import { createFormGuard } from "@/lib/form.ts";
import { For, Loading, Show } from "solid-js";

import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import Dialog from "@/components/dialog.tsx";
import Input from "@/components/input.tsx";
import InputArea from "@/components/input-area.tsx";
import { Cell, Head, Row, Table } from "@/components/table.tsx";
import { formatBytes } from "./states.format.ts";
import type { StatesPresenter } from "./states.presenter.ts";

function DraftFields(props: { presenter: StatesPresenter }): JSX.Element {
  return (
    <>
      <label class="grid gap-1.5 text-base">
        <span>Name</span>
        <Input
          required
          maxlength="80"
          autocomplete="off"
          value={props.presenter.draft().name}
          onInput={(event) => props.presenter.setDraft({ name: event.currentTarget.value })}
        />
      </label>
      <label class="grid gap-1.5 text-base">
        <span>Notes</span>
        <InputArea
          rows="3"
          maxlength="4000"
          value={props.presenter.draft().notes}
          onInput={(event) => props.presenter.setDraft({ notes: event.currentTarget.value })}
        />
      </label>
      <label class="grid gap-1.5 text-base">
        <span>Tags (comma separated)</span>
        <Input
          autocomplete="off"
          value={props.presenter.draft().tags}
          onInput={(event) => props.presenter.setDraft({ tags: event.currentTarget.value })}
        />
      </label>
    </>
  );
}

function Actions(props: { presenter: StatesPresenter; submit: string }): JSX.Element {
  return (
    <div class="flex justify-end gap-2">
      <Button type="button" variant="ghost" onClick={() => props.presenter.close()}>
        Cancel
      </Button>
      <Button type="submit" variant="primary">
        {props.submit}
      </Button>
    </div>
  );
}

export function TakeDialog(props: { presenter: StatesPresenter }): JSX.Element {
  const guard = createFormGuard();
  return (
    <Dialog
      open={props.presenter.taking()}
      onClose={() => props.presenter.close()}
      title="Take state"
      description="Every database adapter is snapshotted at one point in time. Untick adapters to take a partial state."
    >
      <form
        class="grid gap-4"
        ref={guard.ref}
        novalidate
        onSubmit={(event) => {
          if (!guard.accepts(event)) return;
          void props.presenter.take();
        }}
      >
        <FormErrors errors={guard.errors()} />
        <DraftFields presenter={props.presenter} />
        <fieldset class="grid gap-1.5 text-sm">
          <legend>Adapters</legend>
          <Loading fallback={<p class="text-kumo-subtle">Listing adapters...</p>}>
            <For each={props.presenter.databases.value()}>
              {(adapter) => (
                <label class="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={
                      props.presenter.draft().adapter_ids.length === 0 ||
                      props.presenter.draft().adapter_ids.includes(adapter.id)
                    }
                    onChange={() => props.presenter.toggleAdapter(adapter.id)}
                  />
                  <span>
                    {adapter.name} <span class="text-kumo-subtle">({adapter.engine})</span>
                  </span>
                </label>
              )}
            </For>
          </Loading>
        </fieldset>
        <Show when={props.presenter.error()}>
          {(message) => <Banner variant="error">{message()}</Banner>}
        </Show>
        <Actions presenter={props.presenter} submit="Take" />
      </form>
    </Dialog>
  );
}

export function EditDialog(props: { presenter: StatesPresenter }): JSX.Element {
  const guard2 = createFormGuard();
  return (
    <Dialog
      open={props.presenter.editing() !== null}
      onClose={() => props.presenter.close()}
      title={`Edit ${props.presenter.editing()?.name ?? ""}`}
      description="Init states keep their kind; CI filters on it."
    >
      <form
        class="grid gap-4"
        ref={guard2.ref}
        novalidate
        onSubmit={(event) => {
          if (!guard2.accepts(event)) return;
          void props.presenter.save();
        }}
      >
        <FormErrors errors={guard2.errors()} />
        <DraftFields presenter={props.presenter} />
        <Show when={props.presenter.error()}>
          {(message) => <Banner variant="error">{message()}</Banner>}
        </Show>
        <Actions presenter={props.presenter} submit="Save" />
      </form>
    </Dialog>
  );
}

export function DeleteDialog(props: { presenter: StatesPresenter }): JSX.Element {
  const guard3 = createFormGuard();
  return (
    <Dialog
      open={props.presenter.deleting() !== null}
      onClose={() => props.presenter.close()}
      title={`Delete ${props.presenter.deleting()?.name ?? ""}`}
      description="A job reclaims the storage this state holds alone. Checkout history keeps the name."
    >
      <form
        class="grid gap-4"
        ref={guard3.ref}
        novalidate
        onSubmit={(event) => {
          if (!guard3.accepts(event)) return;
          void props.presenter.confirmDelete();
        }}
      >
        <FormErrors errors={guard3.errors()} />
        <Show when={props.presenter.error()}>
          {(message) => <Banner variant="error">{message()}</Banner>}
        </Show>
        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => props.presenter.close()}>
            Cancel
          </Button>
          <Button type="submit" variant="destructive">
            Delete state
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function DetailDialog(props: { presenter: StatesPresenter }): JSX.Element {
  return (
    <Show when={props.presenter.detail()}>
      {(detail) => (
        <Dialog
          open
          onClose={() => props.presenter.close()}
          title={detail().name}
          description={detail().notes ?? "No notes."}
          size="xl"
        >
          <div class="grid gap-4">
            <For each={detail().adapters}>
              {(adapter) => (
                <section class="grid gap-2">
                  <h3 class="font-medium">
                    {adapter.adapter_name}{" "}
                    <span class="text-kumo-subtle">
                      {adapter.engine} {adapter.engine_version} · {adapter.consistency} ·{" "}
                      {adapter.row_count} rows · {formatBytes(adapter.byte_count)}
                    </span>
                  </h3>
                  <Show when={adapter.warnings.length > 0}>
                    <Banner variant="alert">
                      {adapter.warnings.map((warning) => warning.message).join(" · ")}
                    </Banner>
                  </Show>
                  <Table>
                    <thead>
                      <tr>
                        <Head>Table</Head>
                        <Head>Rows</Head>
                        <Head>Size</Head>
                        <Head>Sort</Head>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={adapter.tables}>
                        {(table) => (
                          <Row>
                            <Cell>
                              {table.schema === null ? table.name : `${table.schema}.${table.name}`}
                            </Cell>
                            <Cell>{table.rows}</Cell>
                            <Cell>{formatBytes(table.bytes)}</Cell>
                            <Cell>{table.sort}</Cell>
                          </Row>
                        )}
                      </For>
                    </tbody>
                  </Table>
                </section>
              )}
            </For>
            <div class="flex justify-end">
              <Button type="button" variant="ghost" onClick={() => props.presenter.close()}>
                Close
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </Show>
  );
}

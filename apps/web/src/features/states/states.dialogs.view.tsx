import { Field, Form, createForm, reset } from "@formisch/solid";
import type { FormStore } from "@formisch/solid";
import type { JSX } from "@solidjs/web";
import { For, Loading, Show, createEffect } from "solid-js";
import { deleteStateFormSchema, stateDraftSchema } from "@testate/shared";
import type { StateDraftInput } from "@testate/shared";

import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import Dialog from "@/components/dialog.tsx";
import FieldError from "@/components/field-error.tsx";
import Input from "@/components/input.tsx";
import InputArea from "@/components/input-area.tsx";
import { Cell, Head, Row, Table } from "@/components/table.tsx";
import { consistencyLabel, formatBytes, sortLabel } from "./states.format.ts";
import type { StatesPresenter } from "./states.presenter.ts";

const EMPTY_DRAFT: StateDraftInput = { name: "", notes: "", tags: "", adapter_ids: [] };

/** Name, notes and tags: the fields the take and edit dialogs share, off one schema. */
function DraftFields(props: { form: FormStore<typeof stateDraftSchema> }): JSX.Element {
  return (
    <>
      <Field of={props.form} path={["name"]}>
        {(field) => (
          <label class="grid gap-1.5 text-base">
            <span>Name</span>
            <Input
              {...field.props}
              type="text"
              required
              maxlength="80"
              autocomplete="off"
              value={field.input}
              variant={field.errors ? "error" : "default"}
              aria-invalid={field.errors ? "true" : undefined}
            />
            <FieldError message={field.errors?.[0]} />
          </label>
        )}
      </Field>
      <Field of={props.form} path={["notes"]}>
        {(field) => (
          <label class="grid gap-1.5 text-base">
            <span>Notes</span>
            <InputArea
              {...field.props}
              rows="3"
              maxlength="4000"
              value={field.input}
              variant={field.errors ? "error" : "default"}
              aria-invalid={field.errors ? "true" : undefined}
            />
            <FieldError message={field.errors?.[0]} />
          </label>
        )}
      </Field>
      <Field of={props.form} path={["tags"]}>
        {(field) => (
          <label class="grid gap-1.5 text-base">
            <span>Tags (comma separated)</span>
            <Input
              {...field.props}
              type="text"
              autocomplete="off"
              value={field.input}
              variant={field.errors ? "error" : "default"}
              aria-invalid={field.errors ? "true" : undefined}
            />
            <FieldError message={field.errors?.[0]} />
          </label>
        )}
      </Field>
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
  const form = createForm({ schema: stateDraftSchema });
  createEffect(
    () => props.presenter.taking(),
    (open) => {
      if (open) reset(form, { initialInput: EMPTY_DRAFT });
    }
  );
  return (
    <Dialog
      open={props.presenter.taking()}
      onClose={() => props.presenter.close()}
      title="Take state"
      description="Every database is snapshotted at one point in time. Untick one to take a partial state."
    >
      <Form of={form} class="grid gap-4" onSubmit={(input) => props.presenter.take(input)}>
        <DraftFields form={form} />
        <Field of={form} path={["adapter_ids"]}>
          {(field) => (
            <fieldset class="grid gap-1.5 text-sm">
              <legend>Databases</legend>
              <Loading fallback={<p class="text-muted">Listing adapters...</p>}>
                <For each={props.presenter.databases.value()}>
                  {(adapter) => (
                    <label class="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={
                          (field.input ?? []).length === 0 ||
                          (field.input ?? []).includes(adapter.id)
                        }
                        onChange={() => {
                          const current = field.input ?? [];
                          field.onInput(
                            current.includes(adapter.id)
                              ? current.filter((id) => id !== adapter.id)
                              : [...current, adapter.id]
                          );
                        }}
                      />
                      <span>
                        {adapter.name} <span class="text-muted">({adapter.engine})</span>
                      </span>
                    </label>
                  )}
                </For>
              </Loading>
            </fieldset>
          )}
        </Field>
        <Show when={props.presenter.error()}>
          {(message) => <Banner variant="error">{message()}</Banner>}
        </Show>
        <Actions presenter={props.presenter} submit="Take" />
      </Form>
    </Dialog>
  );
}

export function EditDialog(props: { presenter: StatesPresenter }): JSX.Element {
  const form = createForm({ schema: stateDraftSchema });
  createEffect(
    () => props.presenter.editing(),
    (state) => {
      if (state !== null) {
        reset(form, {
          initialInput: {
            name: state.name,
            notes: state.notes ?? "",
            tags: state.tags.join(", "),
            adapter_ids: [],
          },
        });
      }
    }
  );
  return (
    <Dialog
      open={props.presenter.editing() !== null}
      onClose={() => props.presenter.close()}
      title={`Edit ${props.presenter.editing()?.name ?? ""}`}
      description="Init states keep their kind; CI filters on it."
    >
      <Form of={form} class="grid gap-4" onSubmit={(input) => props.presenter.save(input)}>
        <DraftFields form={form} />
        <Show when={props.presenter.error()}>
          {(message) => <Banner variant="error">{message()}</Banner>}
        </Show>
        <Actions presenter={props.presenter} submit="Save" />
      </Form>
    </Dialog>
  );
}

export function DeleteDialog(props: { presenter: StatesPresenter }): JSX.Element {
  const form = createForm({ schema: deleteStateFormSchema });
  return (
    <Dialog
      open={props.presenter.deleting() !== null}
      onClose={() => props.presenter.close()}
      title={`Delete ${props.presenter.deleting()?.name ?? ""}`}
      description="A job reclaims the storage this state holds alone. Checkout history keeps the name."
    >
      <Form of={form} class="grid gap-4" onSubmit={() => props.presenter.confirmDelete()}>
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
      </Form>
    </Dialog>
  );
}

export function DetailDialog(props: { presenter: StatesPresenter }): JSX.Element {
  return (
    <Dialog
      open={props.presenter.detail() !== null}
      onClose={() => props.presenter.close()}
      title={props.presenter.detail()?.name ?? ""}
      description={props.presenter.detail()?.notes ?? "No notes."}
      size="xl"
    >
      <Show when={props.presenter.detail()}>
        {(detail) => (
          <div class="grid gap-4">
            <For each={detail().adapters}>
              {(adapter) => (
                <section class="grid gap-2">
                  <h3 class="font-medium">
                    {adapter.adapter_name}{" "}
                    <span class="text-muted">
                      {adapter.engine} {adapter.engine_version} ·{" "}
                      {consistencyLabel(adapter.consistency)} · {adapter.row_count} rows ·{" "}
                      {formatBytes(adapter.byte_count)}
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
                            <Cell>{sortLabel(table.sort)}</Cell>
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
        )}
      </Show>
    </Dialog>
  );
}

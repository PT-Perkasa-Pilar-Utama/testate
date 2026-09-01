import { Field, Form, createForm, getInput, reset } from "@formisch/solid";
import type { JSX } from "@solidjs/web";
import { formatWhen } from "@/lib/format.ts";
import { For, Show, createEffect } from "solid-js";
import * as v from "valibot";
import { projectDraftSchema } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import Dialog from "@/components/dialog.tsx";
import FieldError from "@/components/field-error.tsx";
import Input from "@/components/input.tsx";
import { Cell, Head, Row, Table } from "@/components/table.tsx";
import { hasRole } from "@/lib/session.ts";
import type { DeletionAffected } from "../projects/projects.model.ts";
import { toProjectDraft } from "./project.presenter.ts";
import type { ProjectPresenter } from "./project.presenter.ts";

/** What the delete takes with it, in the order a reader cares about; zeroes stay out of the way. */
const AFFECTED_LABELS: [keyof DeletionAffected, string][] = [
  ["adapters", "adapter"],
  ["states", "state"],
  ["protected_states", "of them protected"],
  ["checkouts", "checkout"],
  ["diffs", "diff"],
  ["import_runs", "import run"],
  ["saved_queries", "saved query"],
  ["tokens", "token scoped to this project"],
];

function plural(count: number, label: string): string {
  const many = label.endsWith("y") ? `${label.slice(0, -1)}ies` : `${label}s`;
  return `${count} ${count === 1 || label.startsWith("of them") ? label : many}`;
}

export function AffectedList(props: { affected: DeletionAffected }): JSX.Element {
  const rows = (): string[] =>
    AFFECTED_LABELS.filter(([key]) => props.affected[key] > 0).map(([key, label]) =>
      plural(props.affected[key], label)
    );
  return (
    <Show when={rows().length > 0} fallback={<p class="text-sm">The project holds nothing yet.</p>}>
      <ul class="grid gap-1 text-sm">
        <For each={rows()}>{(row) => <li>{row} will be deleted</li>}</For>
      </ul>
    </Show>
  );
}

export function EditDialog(props: { presenter: ProjectPresenter }): JSX.Element {
  const form = createForm({ schema: projectDraftSchema });

  createEffect(
    () => props.presenter.editing(),
    (open) => {
      if (open)
        reset(form, { initialInput: toProjectDraft(props.presenter.overview.value().project) });
    }
  );

  return (
    <Dialog
      open={props.presenter.editing()}
      onClose={() => props.presenter.closeEdit()}
      title="Edit project"
    >
      <Form of={form} class="grid gap-4" onSubmit={(input) => props.presenter.save(input)}>
        <Field of={form} path={["name"]}>
          {(field) => (
            <label class="grid gap-1.5 text-base">
              <span>Name</span>
              <Input
                {...field.props}
                required
                maxlength="120"
                value={field.input}
                variant={field.errors ? "error" : "default"}
                aria-invalid={field.errors ? "true" : undefined}
              />
              <FieldError message={field.errors?.[0]} />
            </label>
          )}
        </Field>
        <Field of={form} path={["description"]}>
          {(field) => (
            <label class="grid gap-1.5 text-base">
              <span>Description</span>
              <Input
                {...field.props}
                maxlength="2000"
                value={field.input}
                variant={field.errors ? "error" : "default"}
                aria-invalid={field.errors ? "true" : undefined}
              />
              <FieldError message={field.errors?.[0]} />
            </label>
          )}
        </Field>
        <Show when={hasRole("admin")}>
          <Field of={form} path={["quota_gib"]}>
            {(field) => (
              <label class="grid gap-1.5 text-base">
                <span>Snapshot quota in GiB (empty = instance default)</span>
                <Input
                  {...field.props}
                  type="number"
                  min="0"
                  step="0.5"
                  value={field.input}
                  variant={field.errors ? "error" : "default"}
                  aria-invalid={field.errors ? "true" : undefined}
                />
                <FieldError message={field.errors?.[0]} />
              </label>
            )}
          </Field>
        </Show>
        <Show when={props.presenter.editError()}>
          {(message) => <Banner variant="error">{message()}</Banner>}
        </Show>
        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => props.presenter.closeEdit()}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Save
          </Button>
        </div>
      </Form>
    </Dialog>
  );
}

const ACTION_VARIANT = {
  restore: "success",
  force: "warning",
  skip: "secondary",
  none: "outline",
} as const;

export function DeleteDialog(props: { presenter: ProjectPresenter; slug: string }): JSX.Element {
  // Local, not in `@testate/shared`: the one rule here is "matches this project's slug", a value
  // only known at render time, so the shape has nothing to state ahead of it worth sharing.
  const form = createForm({
    schema: v.object({
      confirm_slug: v.pipe(
        v.string(),
        v.check((value) => value === props.slug, "Type the project's slug exactly to confirm.")
      ),
    }),
  });

  createEffect(
    () => props.presenter.plan(),
    (plan) => {
      if (plan !== null) reset(form);
    }
  );

  return (
    <Dialog
      open={props.presenter.plan() !== null}
      onClose={() => props.presenter.closeDelete()}
      title={`Delete ${props.slug}`}
      description="This cannot be undone. Read what goes with the project, then type its slug."
      size="lg"
    >
      <Show when={props.presenter.plan()}>
        {(plan) => (
          <Form
            of={form}
            class="grid gap-4"
            onSubmit={(input) => props.presenter.confirmDelete(input.confirm_slug)}
          >
            <Banner variant="alert">
              Every writable database below returns to its init state. That restore is not stashed:
              anything the databases hold now, and every state that could bring it back, is gone.
              Download the archive of a state you still want before you delete. The plan expires at{" "}
              {formatWhen(plan().expires_at)}.
            </Banner>
            <AffectedList affected={plan().affected} />
            <Table>
              <thead>
                <tr>
                  <Head>Adapter</Head>
                  <Head>Engine</Head>
                  <Head>Action</Head>
                </tr>
              </thead>
              <tbody>
                <For each={plan().adapters}>
                  {(adapter) => (
                    <Row>
                      <Cell>{adapter.name}</Cell>
                      <Cell>{adapter.engine}</Cell>
                      <Cell>
                        <Badge variant={ACTION_VARIANT[adapter.action]}>
                          {adapter.reason === undefined
                            ? adapter.action
                            : `${adapter.action} (${adapter.reason})`}
                        </Badge>
                      </Cell>
                    </Row>
                  )}
                </For>
              </tbody>
            </Table>
            <Field of={form} path={["confirm_slug"]}>
              {(field) => (
                <label class="grid gap-1.5 text-base">
                  <span>Type the slug to confirm</span>
                  <Input
                    {...field.props}
                    required
                    autocomplete="off"
                    placeholder={props.slug}
                    value={field.input}
                    variant={field.errors ? "error" : "default"}
                    aria-invalid={field.errors ? "true" : undefined}
                  />
                  <FieldError message={field.errors?.[0]} />
                </label>
              )}
            </Field>
            <Show when={props.presenter.deleteError()}>
              {(message) => <Banner variant="error">{message()}</Banner>}
            </Show>
            <div class="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => props.presenter.closeDelete()}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={getInput(form, { path: ["confirm_slug"] }) !== props.slug}
              >
                Return to init and delete
              </Button>
            </div>
          </Form>
        )}
      </Show>
    </Dialog>
  );
}

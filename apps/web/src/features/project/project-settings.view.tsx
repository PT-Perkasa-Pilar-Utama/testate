import { Field, Form, createForm, getInput, reset } from "@formisch/solid";
import type { JSX } from "@solidjs/web";
import { formatWhen } from "@/lib/format.ts";
import { For, Loading, Show, createEffect } from "solid-js";
import * as v from "valibot";
import { projectDraftSchema } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import { onceSettled } from "@/lib/form.ts";
import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import Dialog from "@/components/dialog.tsx";
import FieldError from "@/components/field-error.tsx";
import FieldLabel from "@/components/field-label.tsx";
import Input from "@/components/input.tsx";
import InputArea from "@/components/input-area.tsx";
import { Cell, Head, Row, Table, Truncated } from "@/components/table.tsx";
import { engineLabel } from "@/lib/labels.ts";
import { hasRole } from "@/lib/session.ts";
import type { DeletionAffected } from "../projects/projects.model.ts";
import { QuotaSlider } from "../projects/projects.dialogs.view.tsx";
import { PROJECT_BLANK, toProjectDraft } from "./project.presenter.ts";
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
  const form = createForm({
    schema: projectDraftSchema,
    initialInput: PROJECT_BLANK,
  });

  createEffect(
    () =>
      props.presenter.editing() ? toProjectDraft(props.presenter.overview.value().project) : null,
    (draft) => {
      if (draft !== null) onceSettled(() => reset(form, { initialInput: draft }));
    }
  );

  return (
    <Dialog
      open={props.presenter.editing()}
      onClose={() => props.presenter.closeEdit()}
      title="Edit project"
      size="lg"
    >
      <Form of={form} class="grid gap-4" onSubmit={(input) => props.presenter.save(input)}>
        <Field of={form} path={["name"]}>
          {(field) => (
            <label class="grid content-start gap-1.5 text-base">
              <FieldLabel required={true}>Name</FieldLabel>
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
            <label class="grid content-start gap-1.5 text-base">
              <FieldLabel required={false}>Description</FieldLabel>
              {/* A textarea, not a one-line box. The field takes 2000 characters and a single
                  line scrolls sideways as you type, so you cannot read back the sentence you are
                  writing. Three rows is a paragraph without taking over the dialog. */}
              <InputArea
                {...field.props}
                maxlength="2000"
                value={field.input}
                variant={field.errors ? "error" : "default"}
                aria-invalid={field.errors ? "true" : undefined}
                rows="3"
              />
              <FieldError message={field.errors?.[0]} />
            </label>
          )}
        </Field>
        <Show when={hasRole("admin")}>
          <Loading fallback={<p class="text-sm text-muted">Reading the instance default...</p>}>
            <QuotaSlider
              inherited={props.presenter.defaults.value().quota_bytes}
              index={props.presenter.quotaIndex()}
              onIndex={(index) => props.presenter.setQuotaIndex(index)}
            />
          </Loading>
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

type DeletionAction = keyof typeof ACTION_VARIANT;

const ACTION_LABEL = {
  restore: "Restore",
  force: "Restore (forced)",
  skip: "Skip",
  none: "No action",
} as const satisfies Record<DeletionAction, string>;

// `reason` is optional plain text in the schema, not a picklist, so a value the map does not
// carry passes through unchanged.
const REASON_LABEL = {
  read_only: "read only",
  unreachable: "unreachable",
  no_init_state: "no starting point",
  removed: "removed",
} as const;

function reasonLabel(reason: string): string {
  return reason in REASON_LABEL
    ? // SAFETY: the `in` check above proved `reason` names one of REASON_LABEL's own properties.
      REASON_LABEL[reason as keyof typeof REASON_LABEL]
    : reason;
}

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
      if (plan !== null) onceSettled(() => reset(form));
    }
  );

  return (
    <Dialog
      open={props.presenter.plan() !== null}
      onClose={() => props.presenter.closeDelete()}
      title={`Delete ${props.slug}`}
      description="This cannot be undone. Read what goes, then type the project's slug."
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
              <div class="grid gap-1">
                <p>Each database below is put back to its starting point, nothing saved first.</p>
                <p>The project and everything in it is gone for good.</p>
              </div>
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
                      {/* This dialog is 32rem wide and the adapter name is free text up to 80
                          characters, so it gets the narrowest cap here, leaving room for the
                          engine and action columns beside it. */}
                      <Cell>
                        <Truncated class="max-w-[10rem]">{adapter.name}</Truncated>
                      </Cell>
                      <Cell>{engineLabel(adapter.engine)}</Cell>
                      <Cell>
                        <Badge variant={ACTION_VARIANT[adapter.action]}>
                          {adapter.reason === undefined
                            ? ACTION_LABEL[adapter.action]
                            : `${ACTION_LABEL[adapter.action]} (${reasonLabel(adapter.reason)})`}
                        </Badge>
                      </Cell>
                    </Row>
                  )}
                </For>
              </tbody>
            </Table>
            <Field of={form} path={["confirm_slug"]}>
              {(field) => (
                <label class="grid content-start gap-1.5 text-base">
                  <FieldLabel required={true}>Type the slug to confirm</FieldLabel>
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
            {/* The plan is a 15-minute reservation and submitting after it lapses answers "the
                deletion plan is stale", so the way out is worth one line. */}
            <p class="text-xs text-muted">
              Good until {formatWhen(plan().expires_at)}; after that, reopen to refresh it.
            </p>
            <div class="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => props.presenter.closeDelete()}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={getInput(form, { path: ["confirm_slug"] }) !== props.slug}
              >
                Restore and delete
              </Button>
            </div>
          </Form>
        )}
      </Show>
    </Dialog>
  );
}

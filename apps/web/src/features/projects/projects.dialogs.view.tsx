import { Field, Form, createForm, getInput, reset } from "@formisch/solid";
import type { JSX } from "@solidjs/web";
import { Loading, Show, createEffect } from "solid-js";
import { createProjectSchema, projectSlug } from "@testate/shared";

import { onceSettled } from "@/lib/form.ts";
import { formatBytes } from "../states/states.format.ts";
import Banner from "@/components/banner.tsx";
import { DialogActions } from "@/components/dialog.tsx";
import Button from "@/components/button.tsx";
import FormDialog from "@/components/form-dialog.tsx";
import FieldError from "@/components/field-error.tsx";
import FieldLabel from "@/components/field-label.tsx";
import Slider from "@/components/slider.tsx";
import Input from "@/components/input.tsx";
import InputArea from "@/components/input-area.tsx";
import { hasRole } from "@/lib/session.ts";
import { QUOTA_STEPS } from "./projects.presenter.ts";
import type { ProjectsPresenter } from "./projects.presenter.ts";

/** Formisch needs a shape to reset to; a missing `initialInput` leaves the fields undefined. */
const BLANK_PROJECT = { name: "", description: "" } as const;

function quotaLabels(inherited: number): string[] {
  return QUOTA_STEPS.map((step) => {
    if (step === null) return `Instance default (${formatBytes(inherited)})`;
    return step === 0 ? "No limit" : formatBytes(step);
  });
}

/** The quota control, the same one the edit dialog uses, so the two cannot drift apart. */
export function QuotaSlider(props: {
  inherited: number;
  index: number;
  onIndex: (index: number) => void;
}): JSX.Element {
  return (
    <div class="grid gap-1.5 text-sm">
      <span class="flex items-center gap-1.5">
        Snapshot quota
        <span class="text-xs font-normal text-muted">optional</span>
      </span>
      <Slider
        label="Snapshot quota"
        steps={quotaLabels(props.inherited)}
        ends={["Default", "No limit"]}
        index={props.index}
        onIndex={(index) => props.onIndex(index)}
      />
    </div>
  );
}

export function CreateDialog(props: { presenter: ProjectsPresenter }): JSX.Element {
  const form = createForm({ schema: createProjectSchema, initialInput: BLANK_PROJECT });
  const name = (): string => getInput(form, { path: ["name"] }) ?? "";

  createEffect(
    () => props.presenter.creating(),
    (open) => {
      if (open) onceSettled(() => reset(form, { initialInput: BLANK_PROJECT }));
    }
  );

  return (
    <FormDialog
      open={props.presenter.creating()}
      onClose={() => props.presenter.closeCreate()}
      title="New project"
      size="lg"
      description="A project groups adapters and the states taken across them."
    >
      <Form of={form} class="grid gap-4" onSubmit={(input) => props.presenter.submit(input)}>
        <Field of={form} path={["name"]}>
          {(field) => (
            <label class="grid gap-1.5 text-sm">
              <FieldLabel required>Name</FieldLabel>
              <Input
                {...field.props}
                required
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
            <label class="grid gap-1.5 text-sm">
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
        {/* Read-only, and a preview rather than the answer: the API adds `-2` if the slug is taken,
            and only it knows what is taken. */}
        <label class="grid gap-1.5 text-sm">
          <span>URL</span>
          <Input
            readonly
            tabindex="-1"
            aria-label="URL"
            value={`/projects/${projectSlug(name())}`}
          />
        </label>
        <Show when={hasRole("admin")}>
          <Loading fallback={<p class="text-sm text-muted">Reading the instance default...</p>}>
            <QuotaSlider
              inherited={props.presenter.defaults.value().quota_bytes}
              index={props.presenter.quotaIndex()}
              onIndex={(index) => props.presenter.setQuotaIndex(index)}
            />
          </Loading>
        </Show>
        <Show when={props.presenter.error()}>
          {(message) => <Banner variant="error">{message()}</Banner>}
        </Show>
        <DialogActions>
          <Button type="button" variant="ghost" onClick={() => props.presenter.closeCreate()}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Create
          </Button>
        </DialogActions>
      </Form>
    </FormDialog>
  );
}

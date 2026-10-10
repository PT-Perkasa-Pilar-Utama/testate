import { Field, Form, createForm, reset } from "@formisch/solid";
import type { FormStore } from "@formisch/solid";
import type { JSX } from "@solidjs/web";
import { Show, createEffect, untrack } from "solid-js";
import { ingestFormSchema } from "@testate/shared";

import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import ConfirmDialog from "@/components/confirm-dialog.tsx";
import { DialogActions } from "@/components/dialog.tsx";
import FieldError from "@/components/field-error.tsx";
import FieldLabel from "@/components/field-label.tsx";
import FormDialog from "@/components/form-dialog.tsx";
import Input from "@/components/input.tsx";
import Select from "@/components/select.tsx";
import SecretReveal from "@/components/secret-reveal.tsx";
import { onceSettled } from "@/lib/form.ts";
import type { ProjectPick } from "./logs.form.view.tsx";
import { curlFor } from "./logs.ingest.ts";
import type { IngestPresenter } from "./logs.ingest.ts";

function NumberField(props: {
  form: FormStore<typeof ingestFormSchema>;
  path: "retention_days" | "cap_mb";
  label: string;
  help: string;
  max: string;
}): JSX.Element {
  return (
    <Field of={props.form} path={[props.path]}>
      {(field) => (
        <label class="grid content-start gap-1.5 text-base">
          <FieldLabel required={true} help={props.help}>
            {props.label}
          </FieldLabel>
          <Input
            {...field.props}
            type="number"
            min="1"
            max={props.max}
            required
            value={field.input}
            variant={field.errors ? "error" : "default"}
            aria-invalid={field.errors ? "true" : undefined}
          />
          <FieldError message={field.errors?.[0]} />
        </label>
      )}
    </Field>
  );
}

/**
 * "Push from your app" (I8): a name, how long to keep lines, and the size cap. Nothing to dial and
 * no secret to type: Testate makes the token and shows it once after Create.
 */
export function IngestDialog(props: {
  presenter: IngestPresenter;
  project?: ProjectPick | undefined;
}): JSX.Element {
  const form = createForm({
    schema: ingestFormSchema,
    initialInput: untrack(() => props.presenter.seed()),
  });
  const editing = (): boolean => props.presenter.editing() !== null;
  // The dialog stays mounted (design-system rule): every open starts from its own seed.
  createEffect(
    () => (props.presenter.open() ? props.presenter.seed() : null),
    (seed) => {
      if (seed !== null) onceSettled(() => reset(form, { initialInput: seed }));
    }
  );
  return (
    <FormDialog
      open={props.presenter.open()}
      onClose={props.presenter.close}
      title={editing() ? "Edit log adapter" : "New log adapter: push from your app"}
      description="Your app sends its logs to Testate. Read-only: Testate never writes back."
      size="lg"
    >
      <Form of={form} class="grid gap-4" onSubmit={(input) => props.presenter.save(input)}>
        <Show when={props.project}>
          {(project) => (
            <label class="grid content-start gap-1.5 text-base">
              <FieldLabel required={true}>Project</FieldLabel>
              <Select
                options={project().options}
                value={project().value}
                onChange={(slug) => project().onChange(slug)}
              />
            </label>
          )}
        </Show>
        <Field of={form} path={["name"]}>
          {(field) => (
            <label class="grid content-start gap-1.5 text-base">
              <FieldLabel required={true}>Name</FieldLabel>
              <Input
                {...field.props}
                required
                maxlength="80"
                value={field.input}
                variant={field.errors ? "error" : "default"}
                aria-invalid={field.errors ? "true" : undefined}
              />
              <FieldError message={field.errors?.[0]} />
            </label>
          )}
        </Field>
        <div class="grid gap-3 sm:grid-cols-2">
          <NumberField
            form={form}
            path="retention_days"
            label="Keep for (days)"
            help="Older days are removed by the daily sweep."
            max="90"
          />
          <NumberField
            form={form}
            path="cap_mb"
            label="Size cap (MB)"
            help="The oldest days go first to make room; once today alone is full, pushes are refused until tomorrow."
            max="10240"
          />
        </div>
        <Show when={props.presenter.error()}>
          {(message) => <Banner variant="error">{message()}</Banner>}
        </Show>
        <DialogActions>
          <Button type="button" variant="ghost" onClick={() => props.presenter.close()}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={props.presenter.busy()}>
            {editing() ? "Save" : "Create"}
          </Button>
        </DialogActions>
      </Form>
    </FormDialog>
  );
}

/** The token once, with where to send lines and a line that works as pasted (25 §25.7). */
export function IngestReveal(props: { presenter: IngestPresenter }): JSX.Element {
  return (
    <SecretReveal
      secret={props.presenter.revealed()?.token ?? null}
      title={`${props.presenter.revealed()?.name ?? "Log adapter"}: its token`}
      lost="Rotate the token on the adapter's page to get a new one."
      onCopy={() => void props.presenter.copy()}
      onClose={() => props.presenter.dismiss()}
    >
      <Show when={props.presenter.revealed()}>
        {(shown) => (
          <div class="grid gap-1.5 text-sm">
            <span class="text-muted">
              Send <code class="text-[0.9em]">testate</code>-format JSON lines, one per line:
            </span>
            <pre class="overflow-x-auto rounded-md bg-sunken px-3 py-2.5 font-mono text-sm ring ring-hairline select-text">
              {curlFor(shown().url, shown().token)}
            </pre>
          </div>
        )}
      </Show>
    </SecretReveal>
  );
}

/** Rotating stops the app that holds the old token; clearing removes every line. Both asked. */
export function IngestConfirms(props: { presenter: IngestPresenter }): JSX.Element {
  return (
    <>
      <ConfirmDialog
        open={props.presenter.rotating() !== null}
        title="Rotate the token?"
        description="The old token stops at once. Every app that pushes with it gets 401 until it has the new one."
        confirmLabel="Rotate token"
        onConfirm={() => void props.presenter.rotate()}
        onCancel={() => props.presenter.cancelRotate()}
      />
      <ConfirmDialog
        open={props.presenter.clearing() !== null}
        title="Clear every line?"
        description="Every pushed line of this adapter is removed, every source and every day. Pushes after this start again."
        confirmLabel="Clear logs"
        onConfirm={() => void props.presenter.clear()}
        onCancel={() => props.presenter.cancelClear()}
      />
    </>
  );
}

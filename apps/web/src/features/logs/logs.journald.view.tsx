import {
  Field,
  FieldArray,
  Form,
  createForm,
  insert,
  remove,
  reset,
  validate,
} from "@formisch/solid";
import type { FormStore } from "@formisch/solid";
import type { JSX } from "@solidjs/web";
import { For, Show, createEffect, untrack } from "solid-js";
import { journaldFormSchema } from "@testate/shared";

import Button from "@/components/button.tsx";
import FieldError from "@/components/field-error.tsx";
import FieldLabel from "@/components/field-label.tsx";
import FormDialog from "@/components/form-dialog.tsx";
import Icon from "@/components/icon.tsx";
import Input from "@/components/input.tsx";
import InputArea from "@/components/input-area.tsx";
import { onceSettled } from "@/lib/form.ts";
import {
  ConnectionActions,
  ConnectionFields,
  ProbeBanners,
  ProjectField,
} from "./logs.connection.view.tsx";
import type { ProjectPick } from "./logs.connection.view.tsx";
import { BLANK_JOURNAL_SOURCE } from "./logs.journald.ts";
import type { JournaldFormPresenter } from "./logs.journald.ts";

type JournaldFormStore = FormStore<typeof journaldFormSchema>;

/** One source: a name, the units it reads (none for the whole journal), and its masking. */
function JournalSourceFields(props: {
  form: JournaldFormStore;
  index: number;
  removable: boolean;
}): JSX.Element {
  return (
    <fieldset class="grid gap-3 rounded-lg px-4 py-3 ring ring-hairline sm:grid-cols-2">
      <legend class="flex items-center gap-2 px-1 text-sm text-muted">
        Source {props.index + 1}
        <Show when={props.removable}>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => remove(props.form, { path: ["sources"], at: props.index })}
          >
            <Icon name="x" label={`Remove source ${props.index + 1}`} class="h-3 w-3" />
          </Button>
        </Show>
      </legend>
      <Field of={props.form} path={["sources", props.index, "name"]}>
        {(field) => (
          <label class="grid content-start gap-1.5 text-base">
            <FieldLabel required={true}>Source name</FieldLabel>
            <Input
              {...field.props}
              required
              placeholder="api"
              value={field.input}
              variant={field.errors ? "error" : "default"}
              aria-invalid={field.errors ? "true" : undefined}
            />
            <FieldError message={field.errors?.[0]} />
          </label>
        )}
      </Field>
      <Field of={props.form} path={["sources", props.index, "units"]}>
        {(field) => (
          <label class="grid content-start gap-1.5 text-base">
            <FieldLabel
              required={false}
              help="systemd units, separated by spaces or commas. Leave it empty to read the whole journal."
            >
              Units
            </FieldLabel>
            <Input
              {...field.props}
              spellcheck={false}
              placeholder="api.service worker.service"
              value={field.input}
              variant={field.errors ? "error" : "default"}
              aria-invalid={field.errors ? "true" : undefined}
            />
            <FieldError message={field.errors?.[0]} />
          </label>
        )}
      </Field>
      <Field of={props.form} path={["sources", props.index, "patterns"]}>
        {(field) => (
          <label class="grid content-start gap-1.5 text-base sm:col-span-2">
            <FieldLabel
              required={false}
              help="One regular expression per line. Viewers and agents see each match as ***, on top of the built-in secret patterns."
            >
              Mask
            </FieldLabel>
            <InputArea
              {...field.props}
              rows={2}
              spellcheck={false}
              value={field.input}
              aria-invalid={field.errors ? "true" : undefined}
            />
            <FieldError message={field.errors?.[0]} />
          </label>
        )}
      </Field>
    </fieldset>
  );
}

/**
 * Add or edit a journald adapter (#86): one SSH login to a Linux host, holding named groups of
 * systemd units. Testate runs one fixed `journalctl` command there and nothing else (J1).
 */
export function JournaldDialog(props: {
  presenter: JournaldFormPresenter;
  project?: ProjectPick | undefined;
}): JSX.Element {
  const form = createForm({
    schema: journaldFormSchema,
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
  const test = async (): Promise<void> => {
    const result = await validate(form, { shouldFocus: true });
    if (result.success) await props.presenter.test(result.output);
  };
  return (
    <FormDialog
      open={props.presenter.open()}
      onClose={props.presenter.close}
      title={editing() ? "Edit log adapter" : "New log adapter: systemd journal"}
      description="Read-only. Testate runs journalctl over SSH and nothing else. Add the user to the systemd-journal group to read every unit."
      size="lg"
    >
      <Form of={form} class="grid gap-4" onSubmit={(input) => props.presenter.save(input)}>
        <ProjectField project={props.project} />
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
        <ConnectionFields presenter={props.presenter} engine="journald" editing={editing()} />
        <FieldArray of={form} path={["sources"]}>
          {(sources) => (
            <div class="grid gap-3">
              <For each={sources.items}>
                {(_item, index) => (
                  <JournalSourceFields
                    form={form}
                    index={index()}
                    removable={sources.items.length > 1}
                  />
                )}
              </For>
              <FieldError message={sources.errors?.[0]} />
              <div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    insert(form, { path: ["sources"], initialInput: { ...BLANK_JOURNAL_SOURCE } })
                  }
                >
                  <Icon name="plus" class="h-4 w-4" />
                  Add a source
                </Button>
              </div>
            </div>
          )}
        </FieldArray>
        <ProbeBanners presenter={props.presenter} />
        <ConnectionActions
          presenter={props.presenter}
          editing={editing()}
          onTest={() => void test()}
        />
      </Form>
    </FormDialog>
  );
}

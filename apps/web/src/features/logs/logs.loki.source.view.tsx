import { Field, getInput, remove } from "@formisch/solid";
import type { FormStore } from "@formisch/solid";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import type { lokiFormSchema } from "@testate/shared";

import Button from "@/components/button.tsx";
import FieldError from "@/components/field-error.tsx";
import FieldLabel from "@/components/field-label.tsx";
import Icon from "@/components/icon.tsx";
import Input from "@/components/input.tsx";
import InputArea from "@/components/input-area.tsx";
import Select from "@/components/select.tsx";
import { LOG_FORMAT_OPTIONS } from "@/lib/labels.ts";

type LokiFormStore = FormStore<typeof lokiFormSchema>;

function TextField(props: {
  form: LokiFormStore;
  index: number;
  key: "name";
  label: string;
  placeholder: string;
}): JSX.Element {
  return (
    <Field of={props.form} path={["sources", props.index, props.key]}>
      {(field) => (
        <label class="grid content-start gap-1.5 text-base">
          <FieldLabel required={true}>{props.label}</FieldLabel>
          <Input
            {...field.props}
            required
            spellcheck={false}
            placeholder={props.placeholder}
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

/** One source: a name, the LogQL log query it reads, the format of its lines, and its masking. */
export function LokiSourceFields(props: {
  form: LokiFormStore;
  index: number;
  removable: boolean;
}): JSX.Element {
  const regex = (): boolean =>
    getInput(props.form, { path: ["sources", props.index, "format"] }) === "regex";
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
      <TextField
        form={props.form}
        index={props.index}
        key="name"
        label="Source name"
        placeholder="api"
      />
      <Field of={props.form} path={["sources", props.index, "query"]}>
        {(field) => (
          <label class="grid content-start gap-1.5 text-base sm:col-span-2">
            <FieldLabel
              required={true}
              help="A LogQL log query, as you would write it in Grafana. A metric query is refused."
            >
              Query
            </FieldLabel>
            <InputArea
              {...field.props}
              required
              rows={2}
              spellcheck={false}
              placeholder={'{service="api"} |= "error"'}
              value={field.input}
              aria-invalid={field.errors ? "true" : undefined}
            />
            <FieldError message={field.errors?.[0]} />
          </label>
        )}
      </Field>
      <Field of={props.form} path={["sources", props.index, "format"]}>
        {(field) => (
          <label class="grid content-start gap-1.5 text-base">
            <span>Format</span>
            <Select
              options={LOG_FORMAT_OPTIONS}
              value={field.input ?? "plain"}
              onChange={(value) => field.onInput(value)}
            />
          </label>
        )}
      </Field>
      <Show when={regex()}>
        <Field of={props.form} path={["sources", props.index, "regex"]}>
          {(field) => (
            <label class="grid content-start gap-1.5 text-base">
              <FieldLabel
                required={true}
                help="Named groups time, level and message; any other group becomes a field."
              >
                Pattern
              </FieldLabel>
              <Input
                {...field.props}
                spellcheck={false}
                value={field.input}
                variant={field.errors ? "error" : "default"}
                aria-invalid={field.errors ? "true" : undefined}
              />
              <FieldError message={field.errors?.[0]} />
            </label>
          )}
        </Field>
      </Show>
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

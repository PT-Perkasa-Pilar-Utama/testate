import { Field, remove } from "@formisch/solid";
import type { FormStore } from "@formisch/solid";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import type { esFormSchema } from "@testate/shared";

import Button from "@/components/button.tsx";
import FieldError from "@/components/field-error.tsx";
import FieldLabel from "@/components/field-label.tsx";
import Icon from "@/components/icon.tsx";
import Input from "@/components/input.tsx";
import InputArea from "@/components/input-area.tsx";

type EsFormStore = FormStore<typeof esFormSchema>;

function TextField(props: {
  form: EsFormStore;
  index: number;
  key: "name" | "index" | "time_field" | "message_field";
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

/** One source: a name, the indices and query it searches, its two fields, and its masking. */
export function EsSourceFields(props: {
  form: EsFormStore;
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
      <TextField
        form={props.form}
        index={props.index}
        key="name"
        label="Source name"
        placeholder="api"
      />
      <TextField
        form={props.form}
        index={props.index}
        key="index"
        label="Index patterns"
        placeholder="logs-shop-*"
      />
      <Field of={props.form} path={["sources", props.index, "query"]}>
        {(field) => (
          <label class="grid content-start gap-1.5 text-base sm:col-span-2">
            <FieldLabel
              required={false}
              help="A Lucene query, as in Kibana's Lucene mode. Leave it empty to read every document."
            >
              Query
            </FieldLabel>
            <InputArea
              {...field.props}
              rows={2}
              spellcheck={false}
              placeholder="service.name:api AND log.level:error"
              value={field.input}
              aria-invalid={field.errors ? "true" : undefined}
            />
            <FieldError message={field.errors?.[0]} />
          </label>
        )}
      </Field>
      <TextField
        form={props.form}
        index={props.index}
        key="time_field"
        label="Time field"
        placeholder="@timestamp"
      />
      <TextField
        form={props.form}
        index={props.index}
        key="message_field"
        label="Message field"
        placeholder="message"
      />
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

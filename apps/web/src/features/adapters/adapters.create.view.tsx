import { Field, Form, createForm, getInput, reset, setInput } from "@formisch/solid";
import type { JSX } from "@solidjs/web";
import { For, Loading, Show, createEffect, createSignal } from "solid-js";
import type { AdapterCreateFormInput, Engine } from "@testate/shared";
import { adapterCreateFormSchema } from "@testate/shared";

import Banner from "@/components/banner.tsx";
import { DialogActions } from "@/components/dialog.tsx";
import Button from "@/components/button.tsx";
import FormDialog from "@/components/form-dialog.tsx";
import FieldError from "@/components/field-error.tsx";
import FieldLabel from "@/components/field-label.tsx";
import Input from "@/components/input.tsx";
import Select from "@/components/select.tsx";
import { ADAPTER_MODE_OPTIONS, ENGINE_OPTIONS } from "@/lib/labels.ts";
import Switch from "@/components/switch.tsx";
import { onceSettled } from "@/lib/form.ts";
import { ENGINE_FORMS } from "./adapters.fields.ts";
import { parseConnectionUrl, urlPatch } from "./adapters.url.ts";
import type { Field as EngineField } from "./adapters.fields.ts";
import { describeOutcome, outcomeWarnings } from "./adapters.presenter.ts";
import type { AdaptersPresenter } from "./adapters.presenter.ts";

/** Everything but `boolean`, which the switch above draws instead of an `<input>`. */
function inputType(type: EngineField["type"]): "text" | "number" | "password" | "url" {
  return type === "boolean" ? "text" : type;
}

function FieldInput(props: {
  presenter: AdaptersPresenter;
  field: EngineField;
  prefix: string;
}): JSX.Element {
  const key = (): string => `${props.prefix}.${props.field.key}`;
  // A `<Show>` rather than an early return: a prop read in the component body is read once, and
  // this component is reused across engines, so the field it is drawing changes under it.
  return (
    <Show
      when={props.field.type !== "boolean"}
      fallback={
        <div class="grid content-start gap-1.5 text-base">
          <Switch
            checked={props.presenter.values()[key()] === "true"}
            onChange={(on) => props.presenter.setValue(key(), on ? "true" : "false")}
            label={props.field.label}
          />
        </div>
      }
    >
      <label class="grid content-start gap-1.5 text-base">
        <FieldLabel required={props.field.required === true}>{props.field.label}</FieldLabel>
        <Input
          type={inputType(props.field.type)}
          required={props.field.required === true}
          autocomplete={props.field.type === "password" ? "new-password" : "off"}
          placeholder={props.field.placeholder ?? ""}
          value={props.presenter.values()[key()] ?? ""}
          onInput={(event) => props.presenter.setValue(key(), event.currentTarget.value)}
        />
        {/* Only under Host, and only what the API can actually reach from where it runs. The browser
          cannot work its own address out, and the address that matters is the server's anyway:
          the engine dials from there, not from this tab. */}
        <Show when={props.field.key === "host"}>
          <Loading fallback={null}>
            <span class="flex flex-wrap items-center gap-1.5">
              <For each={props.presenter.hosts.value()}>
                {(host) => (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    title={host.label}
                    onClick={() => props.presenter.setValue(key(), host.host)}
                  >
                    {host.host}
                  </Button>
                )}
              </For>
            </span>
          </Loading>
        </Show>
      </label>
    </Show>
  );
}

export function CreateDialog(props: { presenter: AdaptersPresenter }): JSX.Element {
  const form = createForm({
    schema: adapterCreateFormSchema,
    initialInput: { engine: "postgres", name: "", mode: "sandbox" },
  });
  const engine = (): Engine => getInput(form, { path: ["engine"] }) ?? "postgres";
  const engineForm = () => ENGINE_FORMS[engine()];
  const [url, setUrl] = createSignal("");

  // Paste the string from the .env file and the form fills itself, engine included. Half a URL
  // parses to nothing, so typing one out by hand disturbs nothing until it is whole.
  const applyUrl = (text: string): void => {
    setUrl(text);
    const parsed = parseConnectionUrl(text);
    if (parsed === null) return;
    setInput(form, { path: ["engine"], input: parsed.engine });
    for (const [key, value] of Object.entries(urlPatch(parsed))) {
      props.presenter.setValue(key, value);
    }
  };

  // The dialog stays mounted (design-system rule); start every open on a blank form rather than
  // whatever the last attempt left behind.
  createEffect(
    () => props.presenter.creating(),
    (opening) => {
      if (!opening) return;
      setUrl("");
      onceSettled(() => reset(form));
    }
  );
  // A test outcome describes one engine's connectivity; switching engines makes it stale.
  createEffect(
    () => engine(),
    () => {
      // A block, not a concise body: Solid 2 reads an effect's return value as its cleanup and
      // refuses anything that is not a function, which took the whole screen into the boundary.
      props.presenter.invalidateOutcome();
    }
  );

  const readTest = (): AdapterCreateFormInput => {
    const raw = getInput(form);
    return {
      engine: raw.engine ?? "postgres",
      name: (raw.name ?? "").trim(),
      mode: raw.mode ?? "sandbox",
    };
  };

  return (
    <FormDialog
      open={props.presenter.creating()}
      onClose={() => props.presenter.closeCreate()}
      title="New adapter"
      description="Secrets are sealed before they reach the database and never shown again."
      size="lg"
    >
      <Form of={form} class="grid gap-4" onSubmit={(input) => props.presenter.create(input)}>
        <label class="grid content-start gap-1.5 text-base">
          <FieldLabel required={false}>Connection URL</FieldLabel>
          <Input
            type="text"
            autocomplete="off"
            spellcheck={false}
            placeholder="postgresql://user:password@host:5432/database"
            value={url()}
            onInput={(event) => applyUrl(event.currentTarget.value)}
          />
        </label>
        <div class="grid gap-3 sm:grid-cols-2">
          <Field of={form} path={["engine"]}>
            {(field) => (
              <label class="grid content-start gap-1.5 text-base">
                <span>Engine</span>
                <Select
                  options={ENGINE_OPTIONS}
                  value={field.input ?? "postgres"}
                  onChange={(value) => field.onInput(value)}
                />
                <FieldError message={field.errors?.[0]} />
              </label>
            )}
          </Field>
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
        </div>
        {/* Every kind now: a file store in sandbox mode is the one an agent or a tester may put a
            file into, and a read-only one is the one they may not. */}
        <Field of={form} path={["mode"]}>
          {(field) => (
            <label class="grid content-start gap-1.5 text-base">
              <span>Mode</span>
              <Select
                options={ADAPTER_MODE_OPTIONS}
                value={field.input ?? "sandbox"}
                onChange={(value) => field.onInput(value)}
              />
              <FieldError message={field.errors?.[0]} />
            </label>
          )}
        </Field>
        <div class="grid gap-3 sm:grid-cols-2">
          <For each={engineForm().config}>
            {(field) => <FieldInput presenter={props.presenter} field={field} prefix="config" />}
          </For>
          <For each={engineForm().secrets}>
            {(field) => <FieldInput presenter={props.presenter} field={field} prefix="secret" />}
          </For>
        </div>
        <Show when={props.presenter.outcome()}>
          {(outcome) => (
            <>
              <Banner variant="default">{describeOutcome(outcome())}</Banner>
              <For each={outcomeWarnings(outcome())}>
                {(warning) => <Banner variant="alert">{warning}</Banner>}
              </For>
            </>
          )}
        </Show>
        <Show when={props.presenter.error()}>
          {(message) => <Banner variant="error">{message()}</Banner>}
        </Show>
        <DialogActions>
          <Button type="button" variant="ghost" onClick={() => props.presenter.closeCreate()}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={props.presenter.busy()}
            onClick={() => void props.presenter.test(readTest())}
          >
            Test connection
          </Button>
          <Button type="submit" variant="primary" disabled={props.presenter.busy()}>
            Create
          </Button>
        </DialogActions>
      </Form>
    </FormDialog>
  );
}

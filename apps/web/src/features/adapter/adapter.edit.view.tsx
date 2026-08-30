import type { JSX } from "@solidjs/web";
import FormErrors from "@/components/form-errors.tsx";
import { createFormGuard } from "@/lib/form.ts";
import { For, Show } from "solid-js";
import type { Adapter } from "@testate/shared";

import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import Dialog from "@/components/dialog.tsx";
import Input from "@/components/input.tsx";
import InputArea from "@/components/input-area.tsx";
import Select from "@/components/select.tsx";
import { ENGINE_FORMS } from "../adapters/adapters.fields.ts";
import type { Field } from "../adapters/adapters.fields.ts";
import type { AdapterPresenter } from "./adapter.presenter.ts";

const RESTORE_OPTIONS = [
  { value: "atomic", label: "atomic (one transaction)" },
  { value: "fast", label: "fast (no transaction)" },
] as const;

function Fields(props: {
  presenter: AdapterPresenter;
  fields: Field[];
  prefix: string;
  hint?: string;
}): JSX.Element {
  return (
    <For each={props.fields}>
      {(field) => (
        <label class="grid gap-1.5 text-base">
          <span>
            {field.label}
            {props.hint === undefined ? "" : ` ${props.hint}`}
          </span>
          <Input
            type={field.type === "boolean" ? "text" : field.type}
            autocomplete={field.type === "password" ? "new-password" : "off"}
            placeholder={field.placeholder ?? ""}
            value={props.presenter.draft().values[`${props.prefix}.${field.key}`] ?? ""}
            onInput={(event) =>
              props.presenter.setValue(`${props.prefix}.${field.key}`, event.currentTarget.value)
            }
          />
        </label>
      )}
    </For>
  );
}

/** Rename, exclusions, schemas, restore knobs, connection, and credentials (stories 23–26, 28, 29). */
export default function EditDialog(props: {
  presenter: AdapterPresenter;
  adapter: Adapter;
}): JSX.Element {
  const form = (): (typeof ENGINE_FORMS)[Adapter["engine"]] => ENGINE_FORMS[props.adapter.engine];
  const guard = createFormGuard();
  return (
    <Dialog
      open={props.presenter.editing()}
      onClose={() => props.presenter.closeEdit()}
      title={`Edit ${props.adapter.name}`}
      description="Renaming keeps states, mappings, and saved queries. A new host or database takes a new init state."
      size="lg"
    >
      <form
        ref={guard.ref}
        novalidate
        class="grid gap-4"
        onSubmit={(event) => {
          if (!guard.accepts(event)) return;
          void props.presenter.save();
        }}
      >
        <FormErrors errors={guard.errors()} />
        <label class="grid gap-1.5 text-base">
          <span>Name</span>
          <Input
            required
            maxlength="80"
            value={props.presenter.draft().name}
            onInput={(event) => props.presenter.setDraft({ name: event.currentTarget.value })}
          />
        </label>
        <Show when={props.adapter.kind === "database"}>
          <label class="grid gap-1.5 text-base">
            <span>Excluded tables (comma separated; migration tables are excluded by default)</span>
            <InputArea
              rows="2"
              value={props.presenter.draft().excluded_tables}
              onInput={(event) =>
                props.presenter.setDraft({ excluded_tables: event.currentTarget.value })
              }
            />
          </label>
          <Show when={props.adapter.engine === "postgres"}>
            <label class="grid gap-1.5 text-base">
              <span>Schemas (comma separated; empty = every non-system schema)</span>
              <Input
                value={props.presenter.draft().schemas}
                onInput={(event) =>
                  props.presenter.setDraft({ schemas: event.currentTarget.value })
                }
              />
            </label>
          </Show>
          <div class="grid gap-3 sm:grid-cols-2">
            <label class="grid gap-1.5 text-base">
              <span>Restore mode</span>
              <Select
                options={RESTORE_OPTIONS}
                value={props.presenter.draft().restore_mode}
                onChange={(restore_mode) => props.presenter.setDraft({ restore_mode })}
              />
            </label>
            <label class="grid gap-1.5 text-base">
              <span>Lock timeout (ms)</span>
              <Input
                type="number"
                min="1000"
                max="600000"
                value={props.presenter.draft().lock_timeout_ms}
                onInput={(event) =>
                  props.presenter.setDraft({ lock_timeout_ms: event.currentTarget.value })
                }
              />
            </label>
          </div>
        </Show>
        <div class="grid gap-3 sm:grid-cols-2">
          <Fields presenter={props.presenter} fields={form().config} prefix="config" />
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <Fields
            presenter={props.presenter}
            fields={form().secrets}
            prefix="secret"
            hint="(blank keeps the sealed one)"
          />
        </div>
        <Show when={props.adapter.kind === "database"}>
          <div class="grid gap-3 sm:grid-cols-2">
            <Fields
              presenter={props.presenter}
              fields={form().secrets}
              prefix="readonly"
              hint="for read-only sessions (optional)"
            />
          </div>
        </Show>
        <Banner variant="secondary">
          Secrets are sealed before storage and never shown again.
        </Banner>
        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => props.presenter.closeEdit()}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Save adapter
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

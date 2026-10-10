import type { JSX } from "@solidjs/web";
import { For, Loading, Show } from "solid-js";

import Button from "@/components/button.tsx";
import FieldLabel from "@/components/field-label.tsx";
import Input from "@/components/input.tsx";
import Switch from "@/components/switch.tsx";
import type { Field as EngineField } from "./adapters.fields.ts";
import type { AdaptersPresenter } from "./adapters.presenter.ts";

/** Everything but `boolean`, which the switch above draws instead of an `<input>`. */
function inputType(type: EngineField["type"]): "text" | "number" | "password" | "url" {
  return type === "boolean" ? "text" : type;
}

/** What a field reads and writes: the per-engine values and the reachable hosts. */
export type FieldValues = Pick<AdaptersPresenter, "values" | "setValue" | "hosts">;

export function FieldInput(props: {
  presenter: FieldValues;
  field: EngineField;
  prefix: string;
}): JSX.Element {
  const key = (): string => `${props.prefix}.${props.field.key}`;
  // A `<Show>` rather than an early return: a prop read in the component body is read once, and
  // this component is reused across engines, so the field it is drawing changes under it.
  return (
    <Show
      when={props.field.type !== "boolean"}
      // A switch carries its sentence beside it, so it takes the row rather than a column.
      fallback={
        <div class="grid content-start gap-1.5 text-base sm:col-span-2">
          <Switch
            checked={props.presenter.values()[key()] === "true"}
            onChange={(on) => props.presenter.setValue(key(), on ? "true" : "false")}
            label={props.field.label}
          />
        </div>
      }
    >
      <label class="grid content-start gap-1.5 text-base">
        <FieldLabel required={props.field.required === true} help={props.field.hint}>
          {props.field.label}
        </FieldLabel>
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

import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { Engine } from "@testate/shared";

import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import { DialogActions } from "@/components/dialog.tsx";
import FieldLabel from "@/components/field-label.tsx";
import Select from "@/components/select.tsx";
import { FieldInput } from "../adapters/adapters.field-input.view.tsx";
import { engineForm } from "../adapters/adapters.fields.ts";
import type { EngineForm } from "../adapters/adapters.fields.ts";
import { describeOutcome, outcomeWarnings } from "../adapters/adapters.presenter.ts";
import type { ConnectionFormPresenter } from "./logs.connection.ts";

/** The project picker a dialog shows when it opens outside a project: the Logs menu. */
export type ProjectPick = {
  options: { value: string; label: string }[];
  value: string;
  onChange: (slug: string) => void;
};

/** The parts every connection dialog reads; its seed and form types do not matter here. */
type DialogState = Pick<
  ConnectionFormPresenter<never, never>,
  "values" | "setValue" | "hosts" | "outcome" | "error" | "busy" | "close"
>;

export function ProjectField(props: { project: ProjectPick | undefined }): JSX.Element {
  return (
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
  );
}

/** The engine's own login fields; an edit leaves a blank secret as the stored one. */
export function ConnectionFields(props: {
  presenter: DialogState;
  form: Engine | EngineForm;
  editing: boolean;
}): JSX.Element {
  return (
    <div class="grid gap-3 sm:grid-cols-2">
      <For each={engineForm(props.form).config}>
        {(field) => <FieldInput presenter={props.presenter} field={field} prefix="config" />}
      </For>
      <For each={engineForm(props.form).secrets}>
        {(field) => (
          <FieldInput
            presenter={props.presenter}
            field={props.editing ? { ...field, required: false, placeholder: "Unchanged" } : field}
            prefix="secret"
          />
        )}
      </For>
    </div>
  );
}

/** What Test connection found, and why a save was refused. */
export function ProbeBanners(props: { presenter: DialogState }): JSX.Element {
  return (
    <>
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
    </>
  );
}

export function ConnectionActions(props: {
  presenter: DialogState;
  editing: boolean;
  onTest: () => void;
}): JSX.Element {
  return (
    <DialogActions>
      <Button type="button" variant="ghost" onClick={() => props.presenter.close()}>
        Cancel
      </Button>
      {/* Saving an edit probes again; a test here would need the secrets the form never shows. */}
      <Show when={!props.editing}>
        <Button
          type="button"
          variant="secondary"
          disabled={props.presenter.busy()}
          onClick={() => props.onTest()}
        >
          Test connection
        </Button>
      </Show>
      <Button type="submit" variant="primary" disabled={props.presenter.busy()}>
        {props.editing ? "Save" : "Create"}
      </Button>
    </DialogActions>
  );
}

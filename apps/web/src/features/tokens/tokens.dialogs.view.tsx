import { Field, Form, createForm, getInput, reset, setInput } from "@formisch/solid";
import type { JSX } from "@solidjs/web";
import { Show, createEffect } from "solid-js";
import type { TokenKind } from "@testate/shared";
import { tokenDraftSchema } from "@testate/shared";

import Banner from "@/components/banner.tsx";
import { DialogActions } from "@/components/dialog.tsx";
import Button from "@/components/button.tsx";
import FormDialog from "@/components/form-dialog.tsx";
import FieldError from "@/components/field-error.tsx";
import FieldLabel from "@/components/field-label.tsx";
import Input from "@/components/input.tsx";
import Select from "@/components/select.tsx";
import { onceSettled } from "@/lib/form.ts";
import {
  AGENT_EXPIRY_OPTIONS,
  AGENT_ROLE_OPTIONS,
  EXPIRY_OPTIONS,
  ROLE_OPTIONS,
  TOKEN_KIND_OPTIONS,
} from "@/lib/labels.ts";
import { EMPTY_DRAFT } from "./tokens.presenter.ts";
import type { TokensPresenter } from "./tokens.presenter.ts";

export function CreateDialog(props: { presenter: TokensPresenter }): JSX.Element {
  const form = createForm({ schema: tokenDraftSchema, initialInput: EMPTY_DRAFT });
  // Dialogs stay mounted, so the form does not reset itself; put it back to a fresh draft
  // every time this one opens.
  createEffect(
    () => props.presenter.creating(),
    (creating) => {
      if (creating) onceSettled(() => reset(form, { initialInput: EMPTY_DRAFT }));
    }
  );
  const isAgent = (): boolean => getInput(form, { path: ["kind"] }) === "agent";
  // Switching kind moves the two fields whose answers differ by kind. Administrator is not among
  // an agent token's roles, and "never" is not the same answer as leaving an agent's expiry out.
  const onKind = (kind: TokenKind): void => {
    setInput(form, { path: ["kind"], input: kind });
    if (kind === "agent" && getInput(form, { path: ["role"] }) === "admin") {
      setInput(form, { path: ["role"], input: "qa" });
    }
    if (kind === "standard" && getInput(form, { path: ["expiry"] }) === "none") {
      setInput(form, { path: ["expiry"], input: "default" });
    }
  };
  return (
    <FormDialog
      open={props.presenter.creating()}
      onClose={() => props.presenter.closeCreate()}
      title="New API token"
      description="A standard token works on the REST API. An agent token reaches the MCP endpoint alone, where a Guest reads and a Tester also writes."
      size="lg"
    >
      <Form of={form} class="grid gap-4" onSubmit={(input) => props.presenter.create(input)}>
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
          <Field of={form} path={["kind"]}>
            {(field) => (
              <label class="grid content-start gap-1.5 text-base">
                <span>Kind</span>
                <Select
                  options={TOKEN_KIND_OPTIONS}
                  value={field.input ?? EMPTY_DRAFT.kind}
                  onChange={(kind) => onKind(kind)}
                />
              </label>
            )}
          </Field>
          {/* Reads the kind field through `getInput`, not a sibling Field's own render-prop object,
              so this never chains off another Field's narrowed value. */}
          <Field of={form} path={["role"]}>
            {(field) => (
              <label class="grid content-start gap-1.5 text-base">
                <span>Role</span>
                <Select
                  options={isAgent() ? AGENT_ROLE_OPTIONS : ROLE_OPTIONS}
                  value={field.input ?? EMPTY_DRAFT.role}
                  onChange={(role) => field.onInput(role)}
                />
              </label>
            )}
          </Field>
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          {/* One control, three answers. An optional date beside a "never expires" switch said the
              same thing twice, and neither of them said what leaving it blank would do. */}
          <Field of={form} path={["expiry"]}>
            {(field) => (
              <label class="grid content-start gap-1.5 text-base">
                <span>Expires</span>
                <Select
                  options={isAgent() ? AGENT_EXPIRY_OPTIONS : EXPIRY_OPTIONS}
                  value={field.input ?? EMPTY_DRAFT.expiry}
                  onChange={(expiry) => field.onInput(expiry)}
                />
              </label>
            )}
          </Field>
          <Show when={getInput(form, { path: ["expiry"] }) === "date"}>
            <Field of={form} path={["expires_on"]}>
              {(field) => (
                <label class="grid content-start gap-1.5 text-base">
                  <FieldLabel required={true}>Expires on</FieldLabel>
                  <Input
                    {...field.props}
                    type="date"
                    required
                    value={field.input}
                    variant={field.errors ? "error" : "default"}
                    aria-invalid={field.errors ? "true" : undefined}
                  />
                  <FieldError message={field.errors?.[0]} />
                </label>
              )}
            </Field>
          </Show>
        </div>
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

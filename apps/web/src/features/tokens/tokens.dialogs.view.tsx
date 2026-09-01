import { Field, Form, createForm, getInput, reset } from "@formisch/solid";
import type { JSX } from "@solidjs/web";
import { Show, createEffect } from "solid-js";
import { tokenDraftSchema } from "@testate/shared";

import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import Dialog from "@/components/dialog.tsx";
import FieldError from "@/components/field-error.tsx";
import FieldLabel from "@/components/field-label.tsx";
import Input from "@/components/input.tsx";
import Select from "@/components/select.tsx";
import { onceSettled } from "@/lib/form.ts";
import { ROLE_OPTIONS, TOKEN_KIND_OPTIONS } from "@/lib/labels.ts";
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
  return (
    <Dialog
      open={props.presenter.creating()}
      onClose={() => props.presenter.closeCreate()}
      title="New API token"
      description="Standard tokens act as their role on the REST API. Agent tokens are viewer-only and reach the MCP endpoint alone."
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
        <Field of={form} path={["kind"]}>
          {(field) => (
            <label class="grid content-start gap-1.5 text-base">
              <span>Kind</span>
              <Select
                options={TOKEN_KIND_OPTIONS}
                value={field.input ?? EMPTY_DRAFT.kind}
                onChange={(kind) => field.onInput(kind)}
              />
            </label>
          )}
        </Field>
        {/* Reads the kind field through `getInput`, not a sibling Field's own render-prop object,
            so this Show never chains off another Field's narrowed value. */}
        <Show when={getInput(form, { path: ["kind"] }) === "standard"}>
          <Field of={form} path={["role"]}>
            {(field) => (
              <label class="grid content-start gap-1.5 text-base">
                <span>Role</span>
                <Select
                  options={ROLE_OPTIONS}
                  value={field.input ?? EMPTY_DRAFT.role}
                  onChange={(role) => field.onInput(role)}
                />
              </label>
            )}
          </Field>
        </Show>
        <Field of={form} path={["expires_on"]}>
          {(field) => (
            <label class="grid content-start gap-1.5 text-base">
              <FieldLabel required={false}>
                {getInput(form, { path: ["kind"] }) === "agent"
                  ? "Expires on (default 90 days, at most 365)"
                  : "Expires on"}
              </FieldLabel>
              <Input
                {...field.props}
                type="date"
                value={field.input}
                variant={field.errors ? "error" : "default"}
                aria-invalid={field.errors ? "true" : undefined}
              />
              <FieldError message={field.errors?.[0]} />
            </label>
          )}
        </Field>
        <Show when={props.presenter.error()}>
          {(message) => <Banner variant="error">{message()}</Banner>}
        </Show>
        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => props.presenter.closeCreate()}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Create
          </Button>
        </div>
      </Form>
    </Dialog>
  );
}

import { Field, Form, createForm, getErrors, getInput, reset, setInput } from "@formisch/solid";
import type { JSX } from "@solidjs/web";
import { Loading, Show, createEffect, createSignal } from "solid-js";
import type { ScopeChoice, TokenKind } from "@testate/shared";
import { tokenDraftSchema } from "@testate/shared";

import Banner from "@/components/banner.tsx";
import { DialogActions } from "@/components/dialog.tsx";
import Button from "@/components/button.tsx";
import FormDialog from "@/components/form-dialog.tsx";
import FieldError from "@/components/field-error.tsx";
import FieldLabel from "@/components/field-label.tsx";
import Icon from "@/components/icon.tsx";
import Input from "@/components/input.tsx";
import Pending from "@/components/pending.tsx";
import ProjectScope from "@/components/project-scope.tsx";
import Select from "@/components/select.tsx";
import { onceSettled } from "@/lib/form.ts";
import {
  AGENT_EXPIRY_OPTIONS,
  AGENT_ROLE_OPTIONS,
  EXPIRY_OPTIONS,
  ROLE_OPTIONS,
  TOKEN_KIND_OPTIONS,
} from "@/lib/labels.ts";
import { EMPTY_DRAFT, reachesInspect } from "./tokens.presenter.ts";
import type { TokensPresenter } from "./tokens.presenter.ts";

const GUEST_ONLY = ROLE_OPTIONS.filter((option) => option.value === "viewer");

export function CreateDialog(props: { presenter: TokensPresenter }): JSX.Element {
  const form = createForm({ schema: tokenDraftSchema, initialInput: EMPTY_DRAFT });
  // Ticking Inspect locks the role to Guest (#56, Q9). Kept as a signal the scope handlers set,
  // because they run where the projects are already loaded and the role field does not.
  const [inspectLocked, setInspectLocked] = createSignal(false);
  // Dialogs stay mounted, so the form does not reset itself; put it back to a fresh draft
  // every time this one opens, or to an Inspect token when the Inspect page sent us here.
  createEffect(
    () => props.presenter.creating(),
    (creating) => {
      if (!creating) return;
      onceSettled(() => {
        reset(form, { initialInput: EMPTY_DRAFT });
        setInspectLocked(false);
        if (props.presenter.takeInspectPreset()) void applyInspect();
      });
    }
  );
  const isAgent = (): boolean => getInput(form, { path: ["kind"] }) === "agent";
  const roleOptions = () => {
    if (inspectLocked()) return GUEST_ONLY;
    return isAgent() ? AGENT_ROLE_OPTIONS : ROLE_OPTIONS;
  };
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
  /** An agent token that reads Inspect and nothing else, the main reason Inspect exists. */
  const applyInspect = async (): Promise<void> => {
    const id = await props.presenter.inspectProjectId();
    if (id === null) return;
    onKind("agent");
    setInput(form, { path: ["role"], input: "viewer" });
    setInput(form, { path: ["scope"], input: "chosen" });
    setInput(form, { path: ["project_ids"], input: [id] });
    setInspectLocked(true);
  };
  const relock = (scope: ScopeChoice | undefined, picked: readonly string[]): void => {
    const locked = reachesInspect(scope, picked, props.presenter.projects.value());
    setInspectLocked(locked);
    if (locked && getInput(form, { path: ["role"] }) !== "viewer") {
      setInput(form, { path: ["role"], input: "viewer" });
    }
  };
  return (
    <FormDialog
      open={props.presenter.creating()}
      onClose={props.presenter.closeCreate}
      title="New API token"
      description="A standard token works on the REST API. An agent token reaches only the MCP endpoint. A Guest reads there. A Tester also writes."
      size="lg"
    >
      <Form of={form} class="grid gap-4" onSubmit={(input) => props.presenter.create(input)}>
        <div class="flex flex-wrap items-center gap-2 rounded-md bg-sunken px-3 py-2.5 text-sm ring ring-line">
          <Icon name="eye" class="h-4 w-4 shrink-0 text-info-fg" />
          <span class="flex-1 text-muted">An agent that only reads the Inspect project?</span>
          <Button type="button" size="sm" variant="secondary" onClick={() => void applyInspect()}>
            Inspect only
          </Button>
        </div>
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
                  options={roleOptions()}
                  value={field.input ?? EMPTY_DRAFT.role}
                  onChange={(role) => field.onInput(role)}
                />
                <Show when={inspectLocked()}>
                  <span class="text-sm text-muted">A token that reaches Inspect is a Guest.</span>
                </Show>
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
        <Loading fallback={<Pending>Listing projects...</Pending>}>
          <ProjectScope
            projects={props.presenter.projects.value()}
            scope={getInput(form, { path: ["scope"] })}
            picked={getInput(form, { path: ["project_ids"] }) ?? []}
            onScope={(scope) => {
              setInput(form, { path: ["scope"], input: scope });
              relock(scope, getInput(form, { path: ["project_ids"] }) ?? []);
            }}
            onPicked={(picked) => {
              setInput(form, { path: ["project_ids"], input: picked });
              relock(getInput(form, { path: ["scope"] }), picked);
            }}
            scopeError={getErrors(form, { path: ["scope"] })?.[0]}
            pickedError={getErrors(form, { path: ["project_ids"] })?.[0]}
          />
        </Loading>
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

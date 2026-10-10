import {
  Field,
  FieldArray,
  Form,
  createForm,
  getInput,
  insert,
  reset,
  validate,
} from "@formisch/solid";
import type { JSX } from "@solidjs/web";
import { For, createEffect, untrack } from "solid-js";
import { esFormSchema } from "@testate/shared";

import Button from "@/components/button.tsx";
import FieldError from "@/components/field-error.tsx";
import FieldLabel from "@/components/field-label.tsx";
import FormDialog from "@/components/form-dialog.tsx";
import Icon from "@/components/icon.tsx";
import Input from "@/components/input.tsx";
import InputArea from "@/components/input-area.tsx";
import Select from "@/components/select.tsx";
import { onceSettled } from "@/lib/form.ts";
import { ES_AUTH_OPTIONS } from "@/lib/labels.ts";
import {
  ConnectionActions,
  ConnectionFields,
  ProbeBanners,
  ProjectField,
} from "./logs.connection.view.tsx";
import type { ProjectPick } from "./logs.connection.view.tsx";
import { BLANK_ES_SOURCE, ES_FORMS } from "./logs.elasticsearch.ts";
import type { EsFormPresenter } from "./logs.elasticsearch.ts";
import { EsSourceFields } from "./logs.elasticsearch.source.view.tsx";

/**
 * Add or edit an elasticsearch adapter (#92): the cluster's address, login and CA, holding one
 * source per index pattern and query. Testate makes two read calls there and follows no redirect.
 */
export function EsDialog(props: {
  presenter: EsFormPresenter;
  project?: ProjectPick | undefined;
}): JSX.Element {
  const form = createForm({
    schema: esFormSchema,
    initialInput: untrack(() => props.presenter.seed()),
  });
  const auth = (): "none" | "basic" | "api_key" | "bearer" =>
    getInput(form, { path: ["auth"] }) ?? "none";
  const editing = (): boolean => props.presenter.editing() !== null;
  // The dialog stays mounted (design-system rule): every open starts from its own seed.
  createEffect(
    () => (props.presenter.open() ? props.presenter.seed() : null),
    (seed) => {
      if (seed !== null) onceSettled(() => reset(form, { initialInput: seed }));
    }
  );
  createEffect(
    () => auth(),
    () => {
      props.presenter.invalidateOutcome();
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
      title={editing() ? "Edit log adapter" : "New log adapter: Elasticsearch"}
      description="Read-only. Testate only searches the indices you name. Elasticsearch and OpenSearch both work."
      size="lg"
    >
      <Form of={form} class="grid gap-4" onSubmit={(input) => props.presenter.save(input)}>
        <ProjectField project={props.project} />
        <div class="grid gap-3 sm:grid-cols-2">
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
          {/* A different login is a different set of secrets; delete and add again for that. */}
          <Field of={form} path={["auth"]}>
            {(field) => (
              <label class="grid content-start gap-1.5 text-base">
                <span>Login</span>
                <Select
                  options={ES_AUTH_OPTIONS}
                  value={field.input ?? "none"}
                  disabled={editing()}
                  onChange={(value) => field.onInput(value)}
                />
              </label>
            )}
          </Field>
        </div>
        <ConnectionFields presenter={props.presenter} form={ES_FORMS[auth()]} editing={editing()} />
        <Field of={form} path={["tls_ca"]}>
          {(field) => (
            <label class="grid content-start gap-1.5 text-base">
              <FieldLabel
                required={false}
                help="For a cluster that signs its own certificate, as Elasticsearch 8 does: its http_ca.crt."
              >
                CA certificate
              </FieldLabel>
              <InputArea
                {...field.props}
                rows={3}
                spellcheck={false}
                placeholder="-----BEGIN CERTIFICATE-----"
                value={field.input}
                aria-invalid={field.errors ? "true" : undefined}
              />
              <FieldError message={field.errors?.[0]} />
            </label>
          )}
        </Field>
        <FieldArray of={form} path={["sources"]}>
          {(sources) => (
            <div class="grid gap-3">
              <For each={sources.items}>
                {(_item, index) => (
                  <EsSourceFields
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
                    insert(form, { path: ["sources"], initialInput: { ...BLANK_ES_SOURCE } })
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

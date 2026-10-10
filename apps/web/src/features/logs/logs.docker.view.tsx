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
import { dockerFormSchema } from "@testate/shared";

import Button from "@/components/button.tsx";
import FieldError from "@/components/field-error.tsx";
import FieldLabel from "@/components/field-label.tsx";
import FormDialog from "@/components/form-dialog.tsx";
import Icon from "@/components/icon.tsx";
import Input from "@/components/input.tsx";
import Select from "@/components/select.tsx";
import { onceSettled } from "@/lib/form.ts";
import { DOCKER_TRANSPORT_OPTIONS } from "@/lib/labels.ts";
import {
  ConnectionActions,
  ConnectionFields,
  ProbeBanners,
  ProjectField,
} from "./logs.connection.view.tsx";
import type { ProjectPick } from "./logs.connection.view.tsx";
import { BLANK_DOCKER_SOURCE, DOCKER_FORMS } from "./logs.docker.ts";
import type { DockerFormPresenter } from "./logs.docker.ts";
import { DockerSourceFields } from "./logs.docker.source.view.tsx";

/**
 * Add or edit a docker adapter (#88): one way to the daemon, SSH to its socket or TCP, holding one
 * source per container. Testate makes five read-only calls there and nothing else (K2).
 */
export function DockerDialog(props: {
  presenter: DockerFormPresenter;
  project?: ProjectPick | undefined;
}): JSX.Element {
  const form = createForm({
    schema: dockerFormSchema,
    initialInput: untrack(() => props.presenter.seed()),
  });
  const transport = (): "ssh" | "tcp" => getInput(form, { path: ["transport"] }) ?? "ssh";
  const editing = (): boolean => props.presenter.editing() !== null;
  // The dialog stays mounted (design-system rule): every open starts from its own seed.
  createEffect(
    () => (props.presenter.open() ? props.presenter.seed() : null),
    (seed) => {
      if (seed !== null) onceSettled(() => reset(form, { initialInput: seed }));
    }
  );
  createEffect(
    () => transport(),
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
      title={editing() ? "Edit log adapter" : "New log adapter: Docker containers"}
      description="Read-only. Testate only reads container logs. Over SSH the user needs the docker group, which is root on that host; a read-only socket proxy over TCP is safer."
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
          {/* A different transport is a different set of secrets; delete and add again for that. */}
          <Field of={form} path={["transport"]}>
            {(field) => (
              <label class="grid content-start gap-1.5 text-base">
                <span>Reach Docker over</span>
                <Select
                  options={DOCKER_TRANSPORT_OPTIONS}
                  value={field.input ?? "ssh"}
                  disabled={editing()}
                  onChange={(value) => field.onInput(value)}
                />
              </label>
            )}
          </Field>
        </div>
        <ConnectionFields
          presenter={props.presenter}
          form={DOCKER_FORMS[transport()]}
          editing={editing()}
        />
        <FieldArray of={form} path={["sources"]}>
          {(sources) => (
            <div class="grid gap-3">
              <For each={sources.items}>
                {(_item, index) => (
                  <DockerSourceFields
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
                    insert(form, { path: ["sources"], initialInput: { ...BLANK_DOCKER_SOURCE } })
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

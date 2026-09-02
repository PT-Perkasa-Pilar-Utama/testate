import { Field, Form, createForm, getInput, reset } from "@formisch/solid";
import type { JSX } from "@solidjs/web";
import { Show, createEffect } from "solid-js";
import { storeMigrationFormSchema } from "@testate/shared";

import Banner from "@/components/banner.tsx";
import { DialogActions } from "@/components/dialog.tsx";
import { onceSettled } from "@/lib/form.ts";
import Button from "@/components/button.tsx";
import FormDialog from "@/components/form-dialog.tsx";
import FieldError from "@/components/field-error.tsx";
import FieldLabel from "@/components/field-label.tsx";
import Input from "@/components/input.tsx";
import Select from "@/components/select.tsx";
import Switch from "@/components/switch.tsx";
import { STORE_DRIVER_OPTIONS } from "@/lib/labels.ts";
import { MIGRATE_BLANK } from "./settings.presenter.ts";
import type { SettingsPresenter } from "./settings.presenter.ts";

/** Move every snapshot to another store as a job (stories 118, 119). */
export function MigrateDialog(props: { presenter: SettingsPresenter }): JSX.Element {
  // `driver` and `virtual_hosted` are not strings, so they cannot start undefined: a select and
  // a switch have nowhere to show the message that failure would produce.
  const form = createForm({
    schema: storeMigrationFormSchema,
    initialInput: MIGRATE_BLANK,
  });
  createEffect(
    () => (props.presenter.migrating() ? props.presenter.migrateDefaults() : null),
    (defaults) => {
      if (defaults !== null) onceSettled(() => reset(form, { initialInput: defaults }));
    }
  );
  return (
    <FormDialog
      open={props.presenter.migrating()}
      onClose={() => props.presenter.closeMigrate()}
      title="Migrate store"
      size="lg"
      description="Every snapshot copies to the new store before the switch; nothing is lost if the job fails."
    >
      <Form of={form} class="grid gap-4" onSubmit={(input) => props.presenter.migrate(input)}>
        <Field of={form} path={["driver"]}>
          {(field) => (
            <label class="grid gap-1.5 text-sm">
              <span>Target</span>
              <Select
                options={STORE_DRIVER_OPTIONS}
                value={field.input ?? "s3"}
                onChange={(driver) => field.onInput(driver)}
              />
            </label>
          )}
        </Field>
        {/* Reads the field through `getInput`, not a `Show` nested in the driver Field's own
            render callback - that pattern is the stale-narrowed-value trap the skill warns about. */}
        <Show when={getInput(form, { path: ["driver"] }) === "s3"}>
          <div class="grid gap-3 sm:grid-cols-2">
            <Field of={form} path={["bucket"]}>
              {(field) => (
                <label class="grid gap-1.5 text-sm">
                  <FieldLabel required={true}>Bucket</FieldLabel>
                  <Input
                    {...field.props}
                    type="text"
                    required
                    autocomplete="off"
                    value={field.input}
                    variant={field.errors ? "error" : "default"}
                    aria-invalid={field.errors ? "true" : undefined}
                  />
                  <FieldError message={field.errors?.[0]} />
                </label>
              )}
            </Field>
            <Field of={form} path={["prefix"]}>
              {(field) => (
                <label class="grid gap-1.5 text-sm">
                  <FieldLabel required={false}>Prefix</FieldLabel>
                  <Input
                    {...field.props}
                    type="text"
                    autocomplete="off"
                    value={field.input}
                    variant={field.errors ? "error" : "default"}
                    aria-invalid={field.errors ? "true" : undefined}
                  />
                  <FieldError message={field.errors?.[0]} />
                </label>
              )}
            </Field>
            <Field of={form} path={["region"]}>
              {(field) => (
                <label class="grid gap-1.5 text-sm">
                  <FieldLabel required={false}>Region</FieldLabel>
                  <Input
                    {...field.props}
                    type="text"
                    autocomplete="off"
                    value={field.input}
                    variant={field.errors ? "error" : "default"}
                    aria-invalid={field.errors ? "true" : undefined}
                  />
                  <FieldError message={field.errors?.[0]} />
                </label>
              )}
            </Field>
            <Field of={form} path={["endpoint"]}>
              {(field) => (
                <label class="grid gap-1.5 text-sm">
                  <FieldLabel required={false}>Endpoint</FieldLabel>
                  <Input
                    {...field.props}
                    type="text"
                    autocomplete="off"
                    value={field.input}
                    variant={field.errors ? "error" : "default"}
                    aria-invalid={field.errors ? "true" : undefined}
                  />
                  <FieldError message={field.errors?.[0]} />
                </label>
              )}
            </Field>
            <Field of={form} path={["access_key_id"]}>
              {(field) => (
                <label class="grid gap-1.5 text-sm">
                  <FieldLabel required={true}>Access key id</FieldLabel>
                  <Input
                    {...field.props}
                    type="password"
                    required
                    autocomplete="off"
                    value={field.input}
                    variant={field.errors ? "error" : "default"}
                    aria-invalid={field.errors ? "true" : undefined}
                  />
                  <FieldError message={field.errors?.[0]} />
                </label>
              )}
            </Field>
            <Field of={form} path={["secret_access_key"]}>
              {(field) => (
                <label class="grid gap-1.5 text-sm">
                  <FieldLabel required={true}>Secret access key</FieldLabel>
                  <Input
                    {...field.props}
                    type="password"
                    required
                    autocomplete="off"
                    value={field.input}
                    variant={field.errors ? "error" : "default"}
                    aria-invalid={field.errors ? "true" : undefined}
                  />
                  <FieldError message={field.errors?.[0]} />
                </label>
              )}
            </Field>
          </div>
          <Field of={form} path={["virtual_hosted"]}>
            {(field) => (
              <Switch
                label="Virtual-hosted style (off for MinIO)"
                checked={field.input ?? true}
                onChange={(value) => field.onInput(value)}
              />
            )}
          </Field>
          <Banner variant="secondary">Keys are sealed at rest and never shown again.</Banner>
        </Show>
        <Show when={props.presenter.migrateError()}>
          {(message) => <Banner variant="error">{message()}</Banner>}
        </Show>
        <DialogActions>
          <Button type="button" variant="ghost" onClick={() => props.presenter.closeMigrate()}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Start migration
          </Button>
        </DialogActions>
      </Form>
    </FormDialog>
  );
}

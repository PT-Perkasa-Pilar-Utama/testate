import type { JSX } from "@solidjs/web";
import FormErrors from "@/components/form-errors.tsx";
import { createFormGuard } from "@/lib/form.ts";
import { Show } from "solid-js";

import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import Dialog from "@/components/dialog.tsx";
import Input from "@/components/input.tsx";
import Select from "@/components/select.tsx";
import Switch from "@/components/switch.tsx";
import type { S3Draft, SettingsPresenter } from "./settings.presenter.ts";

const DRIVER_OPTIONS = [
  { value: "local", label: "local disk" },
  { value: "s3", label: "S3-compatible bucket" },
] as const;
const FIELDS: { key: keyof S3Draft; label: string; type: "text" | "password" }[] = [
  { key: "bucket", label: "Bucket", type: "text" },
  { key: "prefix", label: "Prefix", type: "text" },
  { key: "region", label: "Region (optional)", type: "text" },
  { key: "endpoint", label: "Endpoint (optional)", type: "text" },
  { key: "access_key_id", label: "Access key id", type: "password" },
  { key: "secret_access_key", label: "Secret access key", type: "password" },
];

/** Move every snapshot to another store as a job (stories 118, 119). */
export function MigrateDialog(props: { presenter: SettingsPresenter }): JSX.Element {
  const guard = createFormGuard();
  return (
    <Dialog
      open={props.presenter.migrating()}
      onClose={() => props.presenter.closeMigrate()}
      title="Migrate store"
      description="Every snapshot copies to the new store before the switch; nothing is lost if the job fails."
    >
      <form
        ref={guard.ref}
        novalidate
        class="grid gap-4"
        onSubmit={(event) => {
          if (!guard.accepts(event)) return;
          void props.presenter.migrate();
        }}
      >
        <FormErrors errors={guard.errors()} />
        <label class="grid gap-1.5 text-sm">
          <span>Target</span>
          <Select
            options={DRIVER_OPTIONS}
            value={props.presenter.targetDriver()}
            onChange={(driver) => props.presenter.setTargetDriver(driver)}
          />
        </label>
        <Show when={props.presenter.targetDriver() === "s3"}>
          <div class="grid gap-3 sm:grid-cols-2">
            {FIELDS.map((field) => (
              <label class="grid gap-1.5 text-sm">
                <span>{field.label}</span>
                <Input
                  type={field.type}
                  autocomplete="off"
                  required={field.key === "bucket" || field.type === "password"}
                  value={String(props.presenter.s3()[field.key])}
                  onInput={(event) =>
                    props.presenter.setS3({ [field.key]: event.currentTarget.value })
                  }
                />
              </label>
            ))}
          </div>
          <Switch
            label="Virtual-hosted style (off for MinIO)"
            checked={props.presenter.s3().virtual_hosted}
            onChange={(value) => props.presenter.setS3({ virtual_hosted: value })}
          />
          <Banner variant="secondary">Keys are sealed at rest and never shown again.</Banner>
        </Show>
        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => props.presenter.closeMigrate()}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Start migration
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

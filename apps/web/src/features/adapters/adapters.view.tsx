import { Field, Form, createForm, getInput, reset } from "@formisch/solid";
import type { JSX } from "@solidjs/web";
import { For, Loading, Show, createEffect } from "solid-js";
import type { AdapterCreateFormInput, Engine } from "@testate/shared";
import { adapterCreateFormSchema } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import { statusReason } from "@/lib/api-error.ts";
import { onceSettled } from "@/lib/form.ts";
import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import Dialog from "@/components/dialog.tsx";
import FieldError from "@/components/field-error.tsx";
import FieldLabel from "@/components/field-label.tsx";
import Input from "@/components/input.tsx";
import Select from "@/components/select.tsx";
import {
  Cell,
  EmptyRow,
  Head,
  Row,
  SortColumn,
  Table,
  TableSearch,
  TableToolbar,
} from "@/components/table.tsx";
import {
  ADAPTER_MODE_LABEL,
  ADAPTER_MODE_OPTIONS,
  ADAPTER_STATUS_LABEL,
  ENGINE_LABEL,
  TIER_LABEL,
} from "@/lib/labels.ts";
import { href, navigate } from "@/lib/router.ts";
import { hasRole } from "@/lib/session.ts";
import { ENGINE_FORMS, ENGINE_OPTIONS, STATUS_VARIANT } from "./adapters.fields.ts";
import type { Field as EngineField } from "./adapters.fields.ts";
import { createAdaptersPresenter, describeOutcome, outcomeWarnings } from "./adapters.presenter.ts";
import type { AdaptersPresenter } from "./adapters.presenter.ts";

function FieldInput(props: {
  presenter: AdaptersPresenter;
  field: EngineField;
  prefix: string;
}): JSX.Element {
  const key = (): string => `${props.prefix}.${props.field.key}`;
  return (
    <label class="grid content-start gap-1.5 text-base">
      <FieldLabel required={props.field.required === true}>{props.field.label}</FieldLabel>
      <Input
        type={props.field.type === "boolean" ? "text" : props.field.type}
        required={props.field.required === true}
        autocomplete={props.field.type === "password" ? "new-password" : "off"}
        placeholder={props.field.placeholder ?? ""}
        value={props.presenter.values()[key()] ?? ""}
        onInput={(event) => props.presenter.setValue(key(), event.currentTarget.value)}
      />
    </label>
  );
}

function CreateDialog(props: { presenter: AdaptersPresenter }): JSX.Element {
  const form = createForm({
    schema: adapterCreateFormSchema,
    initialInput: { engine: "postgres", name: "", mode: "sandbox" },
  });
  const engine = (): Engine => getInput(form, { path: ["engine"] }) ?? "postgres";
  const engineForm = () => ENGINE_FORMS[engine()];

  // The dialog stays mounted (design-system rule); start every open on a blank form rather than
  // whatever the last attempt left behind.
  createEffect(
    () => props.presenter.creating(),
    (opening) => {
      if (opening) onceSettled(() => reset(form));
    }
  );
  // A test outcome describes one engine's connectivity; switching engines makes it stale.
  createEffect(
    () => engine(),
    () => {
      // A block, not a concise body: Solid 2 reads an effect's return value as its cleanup and
      // refuses anything that is not a function, which took the whole screen into the boundary.
      props.presenter.invalidateOutcome();
    }
  );

  const readTest = (): AdapterCreateFormInput => {
    const raw = getInput(form);
    return {
      engine: raw.engine ?? "postgres",
      name: (raw.name ?? "").trim(),
      mode: raw.mode ?? "sandbox",
    };
  };

  return (
    <Dialog
      open={props.presenter.creating()}
      onClose={() => props.presenter.closeCreate()}
      title="New adapter"
      description="Secrets are sealed before they reach the database and never shown again."
      size="lg"
    >
      <Form of={form} class="grid gap-4" onSubmit={(input) => props.presenter.create(input)}>
        <div class="grid gap-3 sm:grid-cols-2">
          <Field of={form} path={["engine"]}>
            {(field) => (
              <label class="grid content-start gap-1.5 text-base">
                <span>Engine</span>
                <Select
                  options={ENGINE_OPTIONS}
                  value={field.input ?? "postgres"}
                  onChange={(value) => field.onInput(value)}
                />
                <FieldError message={field.errors?.[0]} />
              </label>
            )}
          </Field>
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
        </div>
        <Show when={engineForm().kind === "database"}>
          <Field of={form} path={["mode"]}>
            {(field) => (
              <label class="grid content-start gap-1.5 text-base">
                <span>Mode</span>
                <Select
                  options={ADAPTER_MODE_OPTIONS}
                  value={field.input ?? "sandbox"}
                  onChange={(value) => field.onInput(value)}
                />
                <FieldError message={field.errors?.[0]} />
              </label>
            )}
          </Field>
        </Show>
        <div class="grid gap-3 sm:grid-cols-2">
          <For each={engineForm().config}>
            {(field) => <FieldInput presenter={props.presenter} field={field} prefix="config" />}
          </For>
          <For each={engineForm().secrets}>
            {(field) => <FieldInput presenter={props.presenter} field={field} prefix="secret" />}
          </For>
        </div>
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
        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => props.presenter.closeCreate()}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={props.presenter.busy()}
            onClick={() => void props.presenter.test(readTest())}
          >
            Test connection
          </Button>
          <Button type="submit" variant="primary" disabled={props.presenter.busy()}>
            Create
          </Button>
        </div>
      </Form>
    </Dialog>
  );
}

export default function AdaptersView(props: { slug: string }): JSX.Element {
  const presenter = createAdaptersPresenter(() => props.slug);
  const path = (id: string): string => `/projects/${props.slug}/adapters/${id}`;
  return (
    <div class="grid gap-3">
      <Show when={hasRole("qa")}>
        <div class="flex justify-end">
          <Button variant="primary" onClick={() => presenter.openCreate()}>
            New adapter
          </Button>
        </div>
      </Show>
      <Loading fallback={<p class="text-muted">Loading adapters...</p>}>
        <TableToolbar>
          <TableSearch
            label="Search adapters"
            placeholder="name or engine"
            value={presenter.table.query()}
            onInput={(value) => presenter.table.setQuery(value)}
          />
        </TableToolbar>
        <Table>
          <thead>
            <tr>
              <SortColumn view={presenter.table} column="name">
                Name
              </SortColumn>
              <SortColumn view={presenter.table} column="engine">
                Engine
              </SortColumn>
              <SortColumn view={presenter.table} column="tier">
                Tier
              </SortColumn>
              <SortColumn view={presenter.table} column="mode">
                Mode
              </SortColumn>
              <Head>Credential</Head>
              <SortColumn view={presenter.table} column="status">
                Status
              </SortColumn>
            </tr>
          </thead>
          <tbody>
            <Show
              when={presenter.table.rows().length > 0}
              fallback={
                <EmptyRow>
                  <Show
                    when={presenter.value().length > 0}
                    fallback="No adapters yet. Connect the databases behind the system under test to snapshot them."
                  >
                    No adapter matches that search.
                  </Show>
                </EmptyRow>
              }
            >
              <For each={presenter.table.rows()}>
                {(adapter) => (
                  <Row>
                    <Cell>
                      <a
                        class="text-info-fg hover:underline"
                        href={href(path(adapter.id))}
                        onClick={(event) => {
                          event.preventDefault();
                          navigate(path(adapter.id));
                        }}
                      >
                        {adapter.name}
                      </a>
                    </Cell>
                    <Cell>
                      {ENGINE_LABEL[adapter.engine]}
                      {adapter.engine_version === null ? "" : ` ${adapter.engine_version}`}
                    </Cell>
                    <Cell>
                      <Badge variant="outline">{TIER_LABEL[adapter.tier]}</Badge>
                    </Cell>
                    <Cell>
                      <Badge variant={adapter.mode === "read_only" ? "info" : "secondary"}>
                        {ADAPTER_MODE_LABEL[adapter.mode]}
                      </Badge>
                    </Cell>
                    <Cell>
                      <Show
                        when={adapter.credential.set}
                        fallback={<span class="text-muted">none</span>}
                      >
                        <code>
                          {adapter.credential.set ? adapter.credential.key_fingerprint : ""}
                        </code>
                      </Show>
                    </Cell>
                    <Cell>
                      <div class="grid gap-0.5">
                        <Badge variant={STATUS_VARIANT[adapter.status]}>
                          {ADAPTER_STATUS_LABEL[adapter.status]}
                        </Badge>
                        <Show when={adapter.status !== "ok"}>
                          <span class="text-xs text-muted">
                            {statusReason(adapter.status_message) ?? "No reason recorded."}
                          </span>
                        </Show>
                      </div>
                    </Cell>
                  </Row>
                )}
              </For>
            </Show>
          </tbody>
        </Table>
      </Loading>
      <CreateDialog presenter={presenter} />
    </div>
  );
}

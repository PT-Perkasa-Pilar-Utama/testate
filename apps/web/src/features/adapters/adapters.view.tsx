import type { JSX } from "@solidjs/web";
import { For, Loading, Show } from "solid-js";

import Badge from "@/components/badge.tsx";
import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import Dialog from "@/components/dialog.tsx";
import Input from "@/components/input.tsx";
import Select from "@/components/select.tsx";
import { Cell, Head, Row, Table, EmptyRow } from "@/components/table.tsx";
import { href, navigate } from "@/lib/router.ts";
import { hasRole } from "@/lib/session.ts";
import { ENGINE_OPTIONS } from "./adapters.fields.ts";
import type { Field } from "./adapters.fields.ts";
import { createAdaptersPresenter, describeOutcome, outcomeWarnings } from "./adapters.presenter.ts";
import type { AdaptersPresenter } from "./adapters.presenter.ts";

const STATUS_VARIANT = { ok: "success", error: "error", disabled: "secondary" } as const;
const MODE_OPTIONS = [
  { value: "sandbox", label: "sandbox (restores allowed)" },
  { value: "read_only", label: "read-only" },
] as const;

function FieldInput(props: {
  presenter: AdaptersPresenter;
  field: Field;
  prefix: string;
}): JSX.Element {
  const key = (): string => `${props.prefix}.${props.field.key}`;
  return (
    <label class="grid gap-1.5 text-sm">
      <span>{props.field.label}</span>
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
  const onSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    void props.presenter.create();
  };
  return (
    <Dialog
      open={props.presenter.creating()}
      onClose={() => props.presenter.closeCreate()}
      title="New adapter"
      description="Secrets are sealed before they reach the database and never shown again."
      size="lg"
    >
      <form class="grid gap-4" onSubmit={onSubmit}>
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="grid gap-1.5 text-sm">
            <span>Engine</span>
            <Select
              options={ENGINE_OPTIONS}
              value={props.presenter.engine()}
              onChange={(engine) => props.presenter.setEngine(engine)}
            />
          </label>
          <label class="grid gap-1.5 text-sm">
            <span>Name</span>
            <Input
              required
              maxlength="80"
              value={props.presenter.name()}
              onInput={(event) => props.presenter.setName(event.currentTarget.value)}
            />
          </label>
        </div>
        <Show when={props.presenter.form().kind === "database"}>
          <label class="grid gap-1.5 text-sm">
            <span>Mode</span>
            <Select
              options={MODE_OPTIONS}
              value={props.presenter.mode()}
              onChange={(mode) => props.presenter.setMode(mode)}
            />
          </label>
        </Show>
        <div class="grid gap-3 sm:grid-cols-2">
          <For each={props.presenter.form().config}>
            {(field) => <FieldInput presenter={props.presenter} field={field} prefix="config" />}
          </For>
          <For each={props.presenter.form().secrets}>
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
            onClick={() => void props.presenter.test()}
          >
            Test connection
          </Button>
          <Button type="submit" variant="primary" disabled={props.presenter.busy()}>
            Create
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function AdaptersView(props: { slug: string }): JSX.Element {
  const presenter = createAdaptersPresenter(() => props.slug);
  const path = (id: string): string => `/projects/${props.slug}/adapters/${id}`;
  return (
    <div class="grid gap-4">
      <Show when={hasRole("qa")}>
        <div class="flex justify-end">
          <Button variant="primary" onClick={() => presenter.openCreate()}>
            New adapter
          </Button>
        </div>
      </Show>
      <Loading fallback={<p class="text-kumo-subtle">Loading adapters...</p>}>
        <Table>
          <thead>
            <tr>
              <Head>Name</Head>
              <Head>Engine</Head>
              <Head>Tier</Head>
              <Head>Mode</Head>
              <Head>Credential</Head>
              <Head>Status</Head>
            </tr>
          </thead>
          <tbody>
            <Show
              when={presenter.value().length > 0}
              fallback={
                <EmptyRow>
                  No adapters yet. Connect the databases behind the system under test to snapshot
                  them.
                </EmptyRow>
              }
            >
              <For each={presenter.value()}>
                {(adapter) => (
                  <Row>
                    <Cell>
                      <a
                        class="text-kumo-info hover:underline"
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
                      {adapter.engine}
                      {adapter.engine_version === null ? "" : ` ${adapter.engine_version}`}
                    </Cell>
                    <Cell>
                      <Badge variant="outline">{adapter.tier}</Badge>
                    </Cell>
                    <Cell>
                      <Badge variant={adapter.mode === "read_only" ? "info" : "secondary"}>
                        {adapter.mode}
                      </Badge>
                    </Cell>
                    <Cell>
                      <Show
                        when={adapter.credential.set}
                        fallback={<span class="text-kumo-subtle">none</span>}
                      >
                        <code>
                          {adapter.credential.set ? adapter.credential.key_fingerprint : ""}
                        </code>
                      </Show>
                    </Cell>
                    <Cell>
                      <Badge variant={STATUS_VARIANT[adapter.status]}>
                        {adapter.status_message === null
                          ? adapter.status
                          : `${adapter.status}: ${adapter.status_message}`}
                      </Badge>
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

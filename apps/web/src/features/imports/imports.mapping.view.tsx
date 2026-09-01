import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

import Input from "@/components/input.tsx";
import Select from "@/components/select.tsx";
import { Cell, Head, Row, Table } from "@/components/table.tsx";
import { MODE_OPTIONS, TRANSFORM_OPTIONS, tableKey } from "./imports.helpers.ts";
import type { WizardPresenter } from "./imports.wizard.presenter.ts";

/** One card per mode, the choice and its consequence together so neither reads alone (defect 1). */
function ModePicker(props: { presenter: WizardPresenter }): JSX.Element {
  return (
    <fieldset class="grid gap-2">
      <legend class="text-base text-body">What happens to the table's data</legend>
      <div class="grid gap-2 sm:grid-cols-3">
        <For each={MODE_OPTIONS}>
          {(option) => (
            <label
              class={[
                "grid cursor-pointer gap-1 rounded-lg p-3 ring ring-line hover:bg-hover",
                { "ring-2 ring-accent": props.presenter.draft().mode === option.value },
              ]}
            >
              <span class="flex items-center gap-2 font-medium text-heading">
                <input
                  type="radio"
                  name="import-mode"
                  value={option.value}
                  checked={props.presenter.draft().mode === option.value}
                  onChange={() => props.presenter.setDraft({ mode: option.value })}
                />
                {option.label}
              </span>
              <span class="text-sm text-muted">{option.description}</span>
            </label>
          )}
        </For>
      </div>
    </fieldset>
  );
}

function ColumnsTable(props: { presenter: WizardPresenter }): JSX.Element {
  const fileColumns = (): { value: string; label: string }[] => [
    { value: "", label: "(none)" },
    ...(props.presenter.preview()?.columns ?? []).map((name) => ({ value: name, label: name })),
  ];
  return (
    <div class="grid gap-2">
      <Show when={props.presenter.draft().table !== ""}>
        <p class="text-sm text-muted">
          Need a file shaped for this table?{" "}
          <a class="underline" href={props.presenter.sampleUrl("csv")}>
            Sample CSV
          </a>{" "}
          ·{" "}
          <a class="underline" href={props.presenter.sampleUrl("xlsx")}>
            Sample XLSX
          </a>
        </p>
      </Show>
      <Table>
        <thead>
          <tr>
            <Head>Table column</Head>
            <Head>File column</Head>
            <Head>Adjust the value</Head>
          </tr>
        </thead>
        <tbody>
          <For each={props.presenter.draft().columns}>
            {(column) => (
              <Row>
                <Cell>
                  <code>{column.target}</code>
                </Cell>
                <Cell>
                  <Select
                    aria-label={`${column.target}: file column`}
                    options={fileColumns()}
                    value={column.source}
                    onChange={(source) => props.presenter.setColumn(column.target, { source })}
                  />
                </Cell>
                <Cell>
                  <Select
                    aria-label={`${column.target}: adjust the value`}
                    options={TRANSFORM_OPTIONS}
                    value={column.transform}
                    onChange={(transform) =>
                      props.presenter.setColumn(column.target, { transform })
                    }
                  />
                </Cell>
              </Row>
            )}
          </For>
        </tbody>
      </Table>
    </div>
  );
}

/** The reuse pair, deliberately last: naming or picking a mapping is a convenience, not the job (defect 3). */
function ReuseFields(props: { presenter: WizardPresenter }): JSX.Element {
  return (
    <div class="grid gap-3 rounded-lg p-3 ring ring-hairline sm:grid-cols-2">
      <label class="grid content-start gap-1.5 text-base">
        <span>Reuse a saved mapping</span>
        <Select
          options={[
            { value: "", label: "start fresh" },
            ...props.presenter.mappings().map((m) => ({ value: m.id, label: m.name })),
          ]}
          value={props.presenter.mappingId()}
          onChange={(id) => props.presenter.pickMapping(id)}
        />
        <span class="text-sm text-muted">
          Replaces everything above with what that mapping saved.
        </span>
      </label>
      <label class="grid content-start gap-1.5 text-base">
        <span>Save this mapping as</span>
        <Input
          maxlength="80"
          value={props.presenter.draft().name}
          onInput={(event) => props.presenter.setDraft({ name: event.currentTarget.value })}
        />
        <span class="text-sm text-muted">Only matters if you come back to reuse this later.</span>
      </label>
    </div>
  );
}

export default function MappingStep(props: { presenter: WizardPresenter }): JSX.Element {
  return (
    <div class="grid gap-4">
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="grid content-start gap-1.5 text-base">
          <span>Database</span>
          <Select
            options={[
              { value: "", label: "choose a database" },
              ...props.presenter.databases.value().map((a) => ({ value: a.id, label: a.name })),
            ]}
            value={props.presenter.adapterId()}
            onChange={(id) => void props.presenter.setAdapter(id)}
          />
        </label>
        <label class="grid content-start gap-1.5 text-base">
          <span>Table</span>
          <Select
            options={[
              { value: "", label: "choose a table" },
              ...props.presenter.tables().map((t) => ({ value: tableKey(t), label: tableKey(t) })),
            ]}
            value={props.presenter.draft().table}
            onChange={(table) => props.presenter.setTable(table)}
          />
        </label>
      </div>
      <ModePicker presenter={props.presenter} />
      <Show when={props.presenter.draft().mode === "upsert"}>
        <label class="grid content-start gap-1.5 text-base">
          <span>Key columns</span>
          <Input
            placeholder="e.g. email, account_id"
            value={props.presenter.draft().key_columns}
            onInput={(event) =>
              props.presenter.setDraft({ key_columns: event.currentTarget.value })
            }
          />
          <span class="text-sm text-muted">
            Comma separated. A row already in the table with the same values here is updated instead
            of added.
          </span>
        </label>
      </Show>
      <ColumnsTable presenter={props.presenter} />
      <ReuseFields presenter={props.presenter} />
    </div>
  );
}

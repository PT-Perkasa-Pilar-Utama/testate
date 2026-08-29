import type { JSX } from "@solidjs/web";
import { For, Loading, Show } from "solid-js";

import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import Dialog from "@/components/dialog.tsx";
import Input from "@/components/input.tsx";
import Select from "@/components/select.tsx";
import { Cell, Head, Row, Table } from "@/components/table.tsx";
import { TRANSFORMS, tableKey } from "./imports.helpers.ts";
import ReportPanel from "./imports.report.view.tsx";
import SourceStep from "./imports.source.view.tsx";
import type { WizardPresenter } from "./imports.wizard.presenter.ts";

const MODE_OPTIONS = [
  { value: "append", label: "append" },
  { value: "upsert", label: "upsert by key columns" },
  { value: "replace", label: "replace (stash first)" },
] as const;
const TRANSFORM_OPTIONS = TRANSFORMS.map((value) => ({
  value,
  label: value === "" ? "as is" : value,
}));

function MappingStep(props: { presenter: WizardPresenter }): JSX.Element {
  const fileColumns = (): { value: string; label: string }[] => [
    { value: "", label: "(none)" },
    ...(props.presenter.preview()?.columns ?? []).map((name) => ({ value: name, label: name })),
  ];
  return (
    <div class="grid gap-3">
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="grid gap-1.5 text-sm">
          <span>Database adapter</span>
          <Loading fallback={<p class="text-kumo-subtle">Listing adapters...</p>}>
            <Select
              options={[
                { value: "", label: "choose an adapter" },
                ...props.presenter.databases.value().map((a) => ({ value: a.id, label: a.name })),
              ]}
              value={props.presenter.adapterId()}
              onChange={(id) => void props.presenter.setAdapter(id)}
            />
          </Loading>
        </label>
        <label class="grid gap-1.5 text-sm">
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
        <label class="grid gap-1.5 text-sm">
          <span>Saved mapping</span>
          <Select
            options={[
              { value: "", label: "new mapping" },
              ...props.presenter.mappings().map((m) => ({ value: m.id, label: m.name })),
            ]}
            value={props.presenter.mappingId()}
            onChange={(id) => props.presenter.pickMapping(id)}
          />
        </label>
        <label class="grid gap-1.5 text-sm">
          <span>Mapping name</span>
          <Input
            required
            maxlength="80"
            value={props.presenter.draft().name}
            onInput={(event) => props.presenter.setDraft({ name: event.currentTarget.value })}
          />
        </label>
        <label class="grid gap-1.5 text-sm">
          <span>Mode</span>
          <Select
            options={MODE_OPTIONS}
            value={props.presenter.draft().mode}
            onChange={(mode) => props.presenter.setDraft({ mode })}
          />
        </label>
        <label class="grid gap-1.5 text-sm">
          <span>Key columns (comma separated, for upsert)</span>
          <Input
            value={props.presenter.draft().key_columns}
            onInput={(event) =>
              props.presenter.setDraft({ key_columns: event.currentTarget.value })
            }
          />
        </label>
      </div>
      <Show when={props.presenter.draft().table !== ""}>
        <p class="text-sm">
          Sample file for this table:{" "}
          <a class="underline" href={props.presenter.sampleUrl("csv")}>
            CSV
          </a>{" "}
          ·{" "}
          <a class="underline" href={props.presenter.sampleUrl("xlsx")}>
            XLSX
          </a>
        </p>
        <Table>
          <thead>
            <tr>
              <Head>Target column</Head>
              <Head>File column</Head>
              <Head>Transform</Head>
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
                      aria-label={`${column.target} source`}
                      options={fileColumns()}
                      value={column.source}
                      onChange={(source) => props.presenter.setColumn(column.target, { source })}
                    />
                  </Cell>
                  <Cell>
                    <Select
                      aria-label={`${column.target} transform`}
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
      </Show>
    </div>
  );
}

export default function WizardDialog(props: {
  presenter: WizardPresenter;
  rejectedUrl: (runId: string) => string;
}): JSX.Element {
  const ready = (): boolean =>
    props.presenter.preview() !== null &&
    props.presenter.draft().table !== "" &&
    props.presenter.draft().name.trim() !== "" &&
    !props.presenter.busy();
  return (
    <Dialog
      open={props.presenter.open()}
      onClose={() => props.presenter.close()}
      title="Import a file"
      description="Upload, map the columns to one table, dry run, then import. A replace import stashes first."
      size="xl"
    >
      <Show
        when={props.presenter.report()}
        fallback={
          <div class="grid gap-4">
            <SourceStep presenter={props.presenter} />
            <Show when={props.presenter.preview() !== null}>
              <MappingStep presenter={props.presenter} />
            </Show>
            <Show when={props.presenter.error()}>
              {(message) => <Banner variant="error">{message()}</Banner>}
            </Show>
            <div class="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => props.presenter.close()}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={!ready()}
                onClick={() => void props.presenter.run(true)}
              >
                Dry run
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={!ready()}
                onClick={() => void props.presenter.run(false)}
              >
                Run import
              </Button>
            </div>
          </div>
        }
      >
        {(report) => (
          <div class="grid gap-4">
            <ReportPanel
              report={report()}
              rejectedUrl={props.rejectedUrl(report().run_id)}
              onClose={() => props.presenter.close()}
            />
            <Show when={props.presenter.error()}>
              {(message) => <Banner variant="error">{message()}</Banner>}
            </Show>
            <Show when={report().dry_run}>
              <div class="flex justify-end">
                <Button
                  type="button"
                  variant="primary"
                  disabled={props.presenter.busy()}
                  onClick={() => void props.presenter.run(false)}
                >
                  Run import
                </Button>
              </div>
            </Show>
          </div>
        )}
      </Show>
    </Dialog>
  );
}

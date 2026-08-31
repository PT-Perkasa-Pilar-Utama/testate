import type { JSX } from "@solidjs/web";
import { For, Loading, Show, createSignal } from "solid-js";

import Button from "@/components/button.tsx";
import Input from "@/components/input.tsx";
import Select from "@/components/select.tsx";
import Tabs from "@/components/tabs.tsx";
import { Cell, Head, Row, Table } from "@/components/table.tsx";
import type { WizardPresenter } from "./imports.wizard.presenter.ts";

const SOURCES = [
  { id: "upload", label: "Upload a file" },
  { id: "storage", label: "From a storage adapter" },
] as const;

/** A storage adapter and a path inside it as the import source (story 51). */
function StoragePicker(props: { presenter: WizardPresenter }): JSX.Element {
  const [adapterId, setAdapterId] = createSignal("");
  const [path, setPath] = createSignal("");
  return (
    <div class="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
      <label class="grid gap-1.5 text-sm">
        <span>Storage adapter</span>
        <Loading fallback={<p class="text-muted">Listing adapters...</p>}>
          <Select
            options={[
              { value: "", label: "choose an adapter" },
              ...props.presenter.storages.value().map((a) => ({ value: a.id, label: a.name })),
            ]}
            value={adapterId()}
            onChange={(id) => setAdapterId(id)}
          />
        </Loading>
      </label>
      <label class="grid gap-1.5 text-sm">
        <span>Path</span>
        <Input
          placeholder="imports/customers.csv"
          value={path()}
          onInput={(event) => setPath(event.currentTarget.value)}
        />
      </label>
      <Button
        type="button"
        variant="secondary"
        disabled={adapterId() === "" || path().trim() === "" || props.presenter.busy()}
        onClick={() => void props.presenter.useStorage(adapterId(), path().trim())}
      >
        Load file
      </Button>
    </div>
  );
}

export default function SourceStep(props: { presenter: WizardPresenter }): JSX.Element {
  const [mode, setMode] = createSignal<(typeof SOURCES)[number]["id"]>("upload");
  const onFile = (event: Event & { currentTarget: HTMLInputElement }): void => {
    const file = event.currentTarget.files?.[0];
    if (file !== undefined) void props.presenter.upload(file);
  };
  return (
    <div class="grid gap-3">
      <Show when={props.presenter.source() === null}>
        <Tabs items={SOURCES} value={mode()} onChange={(next) => setMode(next)} label="Source" />
        <Show when={mode() === "upload"}>
          <label class="grid gap-1.5 text-sm">
            <span>CSV or XLSX file</span>
            <input type="file" accept=".csv,.xlsx,text/csv" onChange={onFile} />
          </label>
        </Show>
        <Show when={mode() === "storage"}>
          <StoragePicker presenter={props.presenter} />
        </Show>
      </Show>
      <Show when={props.presenter.preview()}>
        {(preview) => (
          <div class="grid gap-2">
            <Show when={preview().sheets}>
              {(sheets) => (
                <label class="grid gap-1.5 text-sm">
                  <span>Sheet</span>
                  <Select
                    options={sheets().map((name) => ({ value: name, label: name }))}
                    value={
                      props.presenter.draft().sheet === ""
                        ? (sheets()[0] ?? "")
                        : props.presenter.draft().sheet
                    }
                    onChange={(sheet) => void props.presenter.setSheet(sheet)}
                  />
                </label>
              )}
            </Show>
            <p class="text-muted text-sm">
              Detected {preview().detected.encoding}, header row {preview().detected.header_row}
              {preview().typed_cells ? ", typed cells" : ""}
            </p>
            <Table>
              <thead>
                <tr>
                  <For each={preview().columns}>{(column) => <Head>{column}</Head>}</For>
                </tr>
              </thead>
              <tbody>
                <For each={preview().rows.slice(0, 5)}>
                  {(row) => (
                    <Row>
                      <For each={row}>{(cell) => <Cell>{JSON.stringify(cell)}</Cell>}</For>
                    </Row>
                  )}
                </For>
              </tbody>
            </Table>
          </div>
        )}
      </Show>
    </div>
  );
}

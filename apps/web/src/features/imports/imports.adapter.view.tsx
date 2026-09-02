import type { JSX } from "@solidjs/web";
import { Errored, For, Loading, Show, createSignal, untrack } from "solid-js";

import AdapterCrumb from "@/features/adapter/adapter.crumb.view.tsx";
import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import FieldLabel from "@/components/field-label.tsx";
import Icon from "@/components/icon.tsx";
import Input from "@/components/input.tsx";
import Select from "@/components/select.tsx";
import { Cell, Head, Row, Table } from "@/components/table.tsx";
import { search } from "@/lib/router.ts";
import { hasRole } from "@/lib/session.ts";
import {
  MODE_OPTIONS,
  blockedReason,
  importBlockedReason,
  reportSummary,
  tableKey,
} from "./imports.helpers.ts";
import { reportCounts } from "./imports.helpers.ts";
import ColumnPanel from "./imports.normalizer.panel.tsx";
import { createImportPresenter } from "./imports.adapter.presenter.ts";
import type { ImportPresenter } from "./imports.adapter.presenter.ts";

/** Drop a file, or name one that already sits in a file store. */
function SourceRow(props: { presenter: ImportPresenter }): JSX.Element {
  const [storeId, setStoreId] = createSignal("");
  const [path, setPath] = createSignal("");
  return (
    <div class="grid gap-3">
      <label class="grid content-start gap-1.5 text-base">
        <FieldLabel required={true}>File</FieldLabel>
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          class="text-base file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-fill file:px-3 file:py-1.5 file:text-body"
          // Not cleared after the pick: the control is the only thing on screen that says which
          // file is loaded, and an emptied one says "No file chosen" over a loaded preview.
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file !== undefined) void props.presenter.upload(file);
          }}
        />
      </label>
      <Show when={props.presenter.storages.value().length > 0}>
        <details class="text-sm text-muted">
          <summary class="cursor-pointer">Or take one from a file store</summary>
          <div class="mt-2 grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
            <label class="grid gap-1.5">
              <span>File store</span>
              <Select
                options={[
                  { value: "", label: "choose a store" },
                  ...props.presenter.storages.value().map((s) => ({ value: s.id, label: s.name })),
                ]}
                value={storeId()}
                onChange={(id) => setStoreId(id)}
              />
            </label>
            <label class="grid gap-1.5">
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
              disabled={storeId() === "" || path().trim() === "" || props.presenter.busy()}
              onClick={() => void props.presenter.useStorage(storeId(), path().trim())}
            >
              Load
            </Button>
          </div>
        </details>
      </Show>
    </div>
  );
}

/** Where the rows came from when nobody picked a file. */
function RejectedNote(): JSX.Element {
  return (
    <Banner variant="default">
      The rows an earlier run rejected are the source. Fix how a column is read below, then import.
    </Banner>
  );
}

/** The first rows of the file, so a date like 03/04/2026 can be recognised before it is read wrong. */
function PreviewRows(props: { presenter: ImportPresenter }): JSX.Element {
  const rows = (): unknown[][] => props.presenter.preview()?.rows.slice(0, 5) ?? [];
  return (
    <Show when={props.presenter.preview()}>
      {(preview) => (
        <div class="grid gap-2">
          <span class="text-sm text-muted">The first rows of the file.</span>
          <Table>
            <thead>
              <tr>
                <For each={preview().columns}>{(column) => <Head identifier>{column}</Head>}</For>
              </tr>
            </thead>
            <tbody>
              <For each={rows()}>
                {(row) => (
                  <Row>
                    <For each={preview().columns}>
                      {(_column, index) => <Cell>{String(row[index()] ?? "")}</Cell>}
                    </For>
                  </Row>
                )}
              </For>
            </tbody>
          </Table>
        </div>
      )}
    </Show>
  );
}

/**
 * One import, on one screen.
 *
 * The adapter is in the URL, so the database question is already answered; what is left is the
 * file, the table, what happens to the rows, and a column panel that stays shut while every column
 * matched. The four-step wizard this replaces asked a data engineer's questions of a tester
 * (docs/PROJECT_REWORK.md).
 */
export default function AdapterImportsView(props: { slug: string; id: string }): JSX.Element {
  // Read once, on purpose. Which run's rejected rows this screen is fixing is decided when it
  // opens; the presenter takes the id as a value and builds its refreshable from it, so a later
  // read would change nothing and only makes this body re-run.
  const rejected = untrack(() => new URLSearchParams(search()).get("rejected") ?? undefined);
  const presenter = createImportPresenter(
    () => props.slug,
    () => props.id,
    () => undefined,
    rejected
  );
  const tables = (): { value: string; label: string }[] => [
    { value: "", label: "choose a table" },
    ...presenter.schema
      .value()
      .map((table) => ({ value: tableKey(table), label: tableKey(table) })),
  ];
  const ready = (): string | null => blockedReason(presenter.draft(), presenter.preview() !== null);
  const blocked = (): string | null =>
    importBlockedReason(presenter.draft(), presenter.preview() !== null, presenter.report());
  return (
    <section class="grid gap-4">
      <div class="grid gap-1.5">
        <h2 class="flex items-center gap-2 text-lg font-semibold tracking-tight text-heading">
          <Icon name="upload" class="h-4 w-4 text-muted" />
          <AdapterCrumb slug={props.slug} id={props.id} /> / import a file
        </h2>
        <p class="max-w-prose text-sm text-muted">
          A CSV or an Excel file into one table of this database. A real run stashes the adapter
          first, so a bad file stays reversible.
        </p>
      </div>
      <Errored fallback={(error) => <Banner variant="error">{String(error())}</Banner>}>
        <Loading fallback={<p class="text-muted">Loading...</p>}>
          {/* Read so the refreshable runs: it is the call that loads a rejected-rows preview. */}
          {presenter.rejected.value()}
          <Show
            when={hasRole("qa")}
            fallback={<Banner variant="default">Importing needs the Tester role.</Banner>}
          >
            <div class="grid gap-4 rounded-lg bg-surface p-4 ring ring-line">
              <Show when={rejected === undefined} fallback={<RejectedNote />}>
                <SourceRow presenter={presenter} />
              </Show>
              <Show when={presenter.preview()}>
                <div class="grid gap-3 sm:grid-cols-2">
                  <label class="grid content-start gap-1.5 text-base">
                    <FieldLabel required={true}>Table</FieldLabel>
                    <Select
                      options={tables()}
                      value={presenter.draft().table}
                      onChange={(table) => presenter.setTable(table)}
                    />
                  </label>
                  <label class="grid content-start gap-1.5 text-base">
                    <span>What happens</span>
                    <Select
                      options={MODE_OPTIONS.map((mode) => ({
                        value: mode.value,
                        label: mode.label,
                      }))}
                      value={presenter.draft().mode}
                      onChange={(mode) => presenter.setDraft({ mode })}
                    />
                  </label>
                </div>
                <p class="text-sm text-muted">
                  {MODE_OPTIONS.find((mode) => mode.value === presenter.draft().mode)?.description}
                </p>
                {/* A normalizer is the saved answer to "how is this file read into this table":
                    which column goes where, how each value is converted, what happens to a row
                    that already exists. It is named within its table, so a weekly one for
                    customers and a weekly one for orders can both be called weekly. */}
                <div class="grid gap-3 sm:grid-cols-2">
                  <label class="grid content-start gap-1.5 text-base">
                    <span>Reuse a saved normalizer</span>
                    <Select
                      options={[
                        { value: "", label: "start fresh" },
                        ...presenter.saved().map((one) => ({ value: one.id, label: one.name })),
                      ]}
                      value={presenter.savedId()}
                      onChange={(id) => presenter.reuse(id)}
                    />
                  </label>
                  <label class="grid content-start gap-1.5 text-base">
                    <span>Save this as</span>
                    <Input
                      placeholder={tableKey({ schema: null, name: presenter.draft().table })}
                      value={presenter.draft().name}
                      onInput={(event) => presenter.setDraft({ name: event.currentTarget.value })}
                    />
                  </label>
                </div>
                {/* Story 149: the shape of a file this table would accept, so the first import is
                    not a guess. The wizard offered it and the screen that replaced the wizard
                    dropped it; the presenter never stopped answering for it. */}
                <Show when={presenter.draft().table !== ""}>
                  <p class="text-sm text-muted">
                    Not sure of the shape?{" "}
                    <a class="underline" href={presenter.sampleUrl("csv")}>
                      Sample CSV
                    </a>{" "}
                    ·{" "}
                    <a class="underline" href={presenter.sampleUrl("xlsx")}>
                      Sample XLSX
                    </a>
                  </p>
                </Show>
                <Show when={presenter.draft().table !== ""}>
                  <ColumnPanel presenter={presenter} />
                </Show>
                <PreviewRows presenter={presenter} />
              </Show>
              <Show when={presenter.error()}>
                {(message) => <Banner variant="error">{message()}</Banner>}
              </Show>
              <Show when={presenter.report()}>
                {(report) => (
                  <Banner variant={report().failed > 0 ? "alert" : "default"}>
                    {reportSummary(reportCounts(report()), report().dry_run)}
                  </Banner>
                )}
              </Show>
              {/* Check, then Import. The check reads every row against the table and says what
                  would be refused; Import stays shut until it comes back clean, and every edit
                  above clears the last report, so it shuts again the moment the file changes. */}
              <div class="flex flex-wrap items-center justify-end gap-2">
                <Show when={blocked()}>
                  {(reason) => <span class="text-sm text-muted">{reason()}</span>}
                </Show>
                <Button
                  variant="secondary"
                  disabled={ready() !== null || presenter.busy()}
                  onClick={() => void presenter.check()}
                >
                  Check the file
                </Button>
                <Button
                  variant="primary"
                  disabled={blocked() !== null || presenter.busy()}
                  onClick={() => void presenter.commit()}
                >
                  <Icon name="upload" class="h-3.5 w-3.5" />
                  Import
                </Button>
              </div>
            </div>
          </Show>
        </Loading>
      </Errored>
    </section>
  );
}

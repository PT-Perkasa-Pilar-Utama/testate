import type { JSX } from "@solidjs/web";
import { For, Show, createSignal } from "solid-js";

import Select from "@/components/select.tsx";
import {
  AUTO,
  DATE_FORMATS,
  HASH_ALGORITHMS,
  NUMBER_LOCALES,
  choiceLabel,
} from "./imports.columns.ts";
import type { Choice, HashAlgorithm } from "./imports.columns.ts";
import type { Column, ImportPresenter } from "./imports.adapter.presenter.ts";

const KINDS = [
  { value: "auto", label: "Auto" },
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "hash", label: "Hash" },
] as const;

/** A kind with the settings it needs, so switching to Date never leaves the format empty. */
function seed(kind: (typeof KINDS)[number]["value"]): Choice {
  if (kind === "text") return { kind: "text" };
  if (kind === "number") return { kind: "number", locale: "" };
  if (kind === "date") return { kind: "date", format: "dd/MM/yyyy", timezone: "" };
  if (kind === "hash") return { kind: "hash", algorithm: "bcrypt" };
  return AUTO;
}

/** Narrowed by the compiler rather than by an assertion, so each settings row is typed. */
function asDate(choice: Choice): Extract<Choice, { kind: "date" }> | null {
  return choice.kind === "date" ? choice : null;
}
function asNumber(choice: Choice): Extract<Choice, { kind: "number" }> | null {
  return choice.kind === "number" ? choice : null;
}
function asHash(choice: Choice): Extract<Choice, { kind: "hash" }> | null {
  return choice.kind === "hash" ? choice : null;
}

/** A hash name back to the four this screen offers; anything else keeps what was already chosen. */
function toAlgorithm(name: string, fallback: HashAlgorithm): HashAlgorithm {
  return HASH_ALGORITHMS.find((one) => one.value === name)?.value ?? fallback;
}

/** The second line under a column, and only for the kinds that have a question left to answer. */
function Settings(props: { choice: Choice; onChange: (choice: Choice) => void }): JSX.Element {
  return (
    <>
      <Show when={asDate(props.choice)}>
        {(date) => (
          <Select
            options={DATE_FORMATS.map((format) => ({ value: format.value, label: format.label }))}
            value={date().format}
            onChange={(format) => props.onChange({ kind: "date", format, timezone: "" })}
          />
        )}
      </Show>
      <Show when={asNumber(props.choice)}>
        {(number) => (
          <Select
            options={NUMBER_LOCALES.map((locale) => ({
              value: locale.value,
              label: locale.label,
            }))}
            value={number().locale}
            onChange={(locale) => props.onChange({ kind: "number", locale })}
          />
        )}
      </Show>
      <Show when={asHash(props.choice)}>
        {(hash) => (
          <Select
            options={HASH_ALGORITHMS.map((one) => ({ value: one.value, label: one.label }))}
            value={hash().algorithm}
            onChange={(name) =>
              props.onChange({ kind: "hash", algorithm: toAlgorithm(name, hash().algorithm) })
            }
          />
        )}
      </Show>
    </>
  );
}

function ColumnCard(props: {
  column: Column;
  fileColumns: readonly string[];
  sample: string;
  presenter: ImportPresenter;
}): JSX.Element {
  const set = (patch: Partial<Column>): void =>
    props.presenter.setColumn(props.column.target, patch);
  return (
    <div class="grid gap-2 rounded-md p-3 ring ring-hairline">
      <div class="grid gap-0.5">
        <span class="truncate font-medium text-heading">{props.column.target}</span>
        {/* The sample is the reason the panel exists: 03/04/2026 is 3 April or 4 March and the
            header alone never says which. */}
        <span class="truncate font-mono text-xs text-muted" title={props.sample}>
          {props.sample === "" ? "no value in the first row" : props.sample}
        </span>
      </div>
      <label class="grid gap-1 text-sm">
        <span class="text-muted">From</span>
        <Select
          options={[
            { value: "", label: "leave empty" },
            ...props.fileColumns.map((name) => ({ value: name, label: name })),
          ]}
          value={props.column.source}
          onChange={(source) => set({ source })}
        />
      </label>
      <label class="grid gap-1 text-sm">
        <span class="text-muted">Read as</span>
        <Select
          options={KINDS.map((kind) => ({ value: kind.value, label: kind.label }))}
          value={props.column.choice.kind}
          onChange={(kind) => set({ choice: seed(kind) })}
        />
        <Settings choice={props.column.choice} onChange={(choice) => set({ choice })} />
      </label>
    </div>
  );
}

/**
 * How each column is read, shut until it is asked for.
 *
 * Auto covers most files: the engine parses `2026-01-31` into a date column by itself. The panel
 * opens itself when a column did not match by name, because that is the case a person has to
 * answer before pressing Import.
 */
export default function ColumnPanel(props: { presenter: ImportPresenter }): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const matched = (): { filled: number; total: number } => props.presenter.matched();
  const complete = (): boolean => matched().filled === matched().total;
  const fileColumns = (): readonly string[] => props.presenter.preview()?.columns ?? [];
  const sampleOf = (column: Column): string => {
    const index = fileColumns().indexOf(column.source);
    const first = props.presenter.preview()?.rows[0];
    return index === -1 || first === undefined ? "" : String(first[index] ?? "");
  };
  const shown = (): boolean => open() || !complete();
  return (
    <div class="grid gap-3">
      <button
        type="button"
        class="flex w-fit cursor-pointer items-center gap-2 text-base text-body hover:underline"
        aria-expanded={shown() ? "true" : "false"}
        onClick={() => setOpen(!open())}
      >
        <span aria-hidden="true">{shown() ? "▾" : "▸"}</span>
        <span>
          {matched().filled} of {matched().total} columns matched by name
        </span>
      </button>
      <Show when={shown()}>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <For each={props.presenter.draft().columns}>
            {(column) => (
              <ColumnCard
                column={column}
                fileColumns={fileColumns()}
                sample={sampleOf(column)}
                presenter={props.presenter}
              />
            )}
          </For>
        </div>
        <p class="text-sm text-muted">
          Auto trims the value, leaves an empty cell as NULL where the column allows one, and hands
          the rest to the column's own type. Reach for the others when the file does not already
          speak the database's language. {choiceLabel(AUTO)} is the default.
        </p>
      </Show>
    </div>
  );
}

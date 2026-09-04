import type { JSX } from "@solidjs/web";
import { For, Show, createSignal } from "solid-js";

import Input from "@/components/input.tsx";
import Select from "@/components/select.tsx";
import { Cell, Head, Row, Table } from "@/components/table.tsx";
import { AUTO, DATE_FORMATS, HASH_ALGORITHMS, NUMBER_LOCALES } from "./imports.columns.ts";
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
  if (kind === "hash") return { kind: "hash", algorithm: "bcrypt", salt: "" };
  return AUTO;
}

/** Narrowed by the compiler rather than by an assertion, so each settings cell is typed. */
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

/** SHA takes a salt a person types; bcrypt and Argon2id make one per value on their own. */
function takesSalt(algorithm: HashAlgorithm): boolean {
  return algorithm === "sha256" || algorithm === "sha512";
}

/** The setting a kind still needs answered; empty for Auto and Text. */
function Settings(props: { choice: Choice; onChange: (choice: Choice) => void }): JSX.Element {
  return (
    <>
      <Show when={asDate(props.choice)}>
        {(date) => (
          <Select
            aria-label="Date format"
            options={DATE_FORMATS.map((format) => ({ value: format.value, label: format.label }))}
            value={date().format}
            onChange={(format) => props.onChange({ kind: "date", format, timezone: "" })}
          />
        )}
      </Show>
      <Show when={asNumber(props.choice)}>
        {(number) => (
          <Select
            aria-label="Number format"
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
          <span class="flex flex-wrap items-center gap-2">
            <Select
              aria-label="Hash algorithm"
              options={HASH_ALGORITHMS.map((one) => ({ value: one.value, label: one.label }))}
              value={hash().algorithm}
              onChange={(name) =>
                props.onChange({
                  kind: "hash",
                  algorithm: toAlgorithm(name, hash().algorithm),
                  salt: "",
                })
              }
            />
            <Show when={takesSalt(hash().algorithm)}>
              <Input
                size="sm"
                class="w-40"
                aria-label="Salt"
                placeholder="salt, optional"
                autocomplete="off"
                value={hash().salt}
                onInput={(event) => props.onChange({ ...hash(), salt: event.currentTarget.value })}
              />
            </Show>
          </span>
        )}
      </Show>
    </>
  );
}

function ColumnRow(props: {
  column: Column;
  fileColumns: readonly string[];
  sample: string;
  presenter: ImportPresenter;
}): JSX.Element {
  const set = (patch: Partial<Column>): void =>
    props.presenter.setColumn(props.column.target, patch);
  return (
    <Row>
      <Cell>
        <span class="grid gap-0.5">
          <code class="truncate font-medium text-heading">{props.column.target}</code>
          {/* The sample is the reason the panel exists: 03/04/2026 is 3 April or 4 March and the
              header alone never says which. */}
          <span class="truncate font-mono text-xs text-muted" title={props.sample}>
            {props.sample === "" ? "no value in the first row" : props.sample}
          </span>
        </span>
      </Cell>
      <Cell>
        <Select
          aria-label={`Column of the file for ${props.column.target}`}
          options={[
            { value: "", label: "leave empty" },
            ...props.fileColumns.map((name) => ({ value: name, label: name })),
          ]}
          value={props.column.source}
          onChange={(source) => set({ source })}
        />
      </Cell>
      <Cell>
        <Select
          aria-label={`Read ${props.column.target} as`}
          options={KINDS.map((kind) => ({ value: kind.value, label: kind.label }))}
          value={props.column.choice.kind}
          onChange={(kind) => set({ choice: seed(kind) })}
        />
      </Cell>
      <Cell>
        <Settings choice={props.column.choice} onChange={(choice) => set({ choice })} />
      </Cell>
    </Row>
  );
}

/**
 * How each column is read, shut until it is asked for: one row per column of the table, with
 * the file's first value beside it. Auto covers most files: the engine parses `2026-01-31` into
 * a date column by itself. The panel opens itself when a column did not match by name, because
 * that is the case a person has to answer before pressing Import.
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
  const hashes = (): boolean =>
    props.presenter.draft().columns.some((column) => column.choice.kind === "hash");
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
        <Table>
          <thead>
            <tr>
              <Head>Column</Head>
              <Head>From the file</Head>
              <Head>Read as</Head>
              <Head>Setting</Head>
            </tr>
          </thead>
          <tbody>
            <For each={props.presenter.draft().columns}>
              {(column) => (
                <ColumnRow
                  column={column}
                  fileColumns={fileColumns()}
                  sample={sampleOf(column)}
                  presenter={props.presenter}
                />
              )}
            </For>
          </tbody>
        </Table>
        <p class="text-sm text-muted">
          Auto trims the value, makes an empty cell NULL where the column allows it, and lets the
          column's own type read the rest.
          <Show when={hashes()}>
            {" "}
            A hash is made here from the file's text, and only the hash is written. bcrypt and
            Argon2id salt each value on their own. SHA takes the salt you type, or none.
          </Show>
        </p>
      </Show>
    </div>
  );
}

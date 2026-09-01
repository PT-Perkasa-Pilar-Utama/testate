import type { JSX } from "@solidjs/web";
import PageHeader from "@/components/page-header.tsx";
import { For, Show } from "solid-js";

import Button from "@/components/button.tsx";
import Icon from "@/components/icon.tsx";
import type { IconName } from "@/components/icon.tsx";
import Input from "@/components/input.tsx";
import LayerCard from "@/components/layer-card.tsx";
import Select from "@/components/select.tsx";
import { ALGORITHMS, ENCODINGS, createToolsPresenter } from "./tools.presenter.ts";
import type { ToolsPresenter } from "./tools.presenter.ts";

const ALGORITHM_OPTIONS = ALGORITHMS.map((value) => ({ value, label: value }));
const ENCODING_OPTIONS = ENCODINGS.map((value) => ({ value, label: value }));

/** A card's own name, so three generators read as three tools and not three settings sections. */
function CardTitle(props: { icon: IconName; children: JSX.Element }): JSX.Element {
  return (
    <h3 class="flex items-center gap-1.5 text-base font-semibold text-heading">
      <Icon name={props.icon} class="h-4 w-4 text-muted" />
      {props.children}
    </h3>
  );
}

/**
 * A generated value: monospace, and one press from the clipboard, which is what it is for.
 *
 * `min-w-0` on the row, not only on the text inside it. A grid item will not shrink below its own
 * content, so a 60-character hash made this row wider than the card holding it and the row spilled
 * out over the card beside it; truncating the text cannot help while its parent is oversized.
 */
function Result(props: { value: string | null; onCopy: (value: string) => void }): JSX.Element {
  return (
    <Show when={props.value}>
      {(value) => (
        <div class="flex min-w-0 items-center gap-2 rounded-md bg-hover px-3 py-2">
          <output class="min-w-0 flex-1 truncate font-mono text-sm">{value()}</output>
          <Button size="xs" variant="ghost" aria-label="Copy" onClick={() => props.onCopy(value())}>
            <Icon name="copy" class="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </Show>
  );
}

function HashCard(props: { presenter: ToolsPresenter }): JSX.Element {
  return (
    <LayerCard class="grid gap-4 px-5 py-4">
      <div class="grid gap-1">
        <CardTitle icon="key-round">Hash</CardTitle>
        <p class="text-sm text-muted">
          The same functions column policies apply, so a hashed column never receives raw input.
        </p>
      </div>
      <div class="grid gap-3">
        <label class="grid content-start gap-1.5 text-base">
          <span>Algorithm</span>
          <Select
            options={ALGORITHM_OPTIONS}
            value={props.presenter.algorithm()}
            onChange={(value) => props.presenter.setAlgorithm(value)}
          />
        </label>
        <label class="grid content-start gap-1.5 text-base">
          <span>Value</span>
          <Input
            required
            value={props.presenter.value()}
            onInput={(event) => props.presenter.setValue(event.currentTarget.value)}
          />
        </label>
        <label class="grid content-start gap-1.5 text-base">
          <span>Secret or seed (optional)</span>
          <Input
            type="password"
            autocomplete="off"
            value={props.presenter.secret()}
            onInput={(event) => props.presenter.setSecret(event.currentTarget.value)}
          />
        </label>
      </div>
      {/* There is nothing to hash without a value, and asking the server produces a message
          written for whoever is driving the API rather than for the person looking at this. */}
      <Button
        variant="primary"
        disabled={props.presenter.value() === ""}
        title={props.presenter.value() === "" ? "Enter a value to hash" : undefined}
        onClick={() => void props.presenter.runHash()}
      >
        Hash
      </Button>
      <Result value={props.presenter.hash()} onCopy={(value) => void props.presenter.copy(value)} />
    </LayerCard>
  );
}

function RandomCard(props: { presenter: ToolsPresenter }): JSX.Element {
  return (
    <LayerCard class="grid gap-4 px-5 py-4">
      <CardTitle icon="zap">Random bytes</CardTitle>
      <div class="grid gap-3">
        <label class="grid content-start gap-1.5 text-base">
          <span>Bytes (8 to 1024)</span>
          <Input
            type="number"
            min="8"
            max="1024"
            value={props.presenter.bytes()}
            onInput={(event) => props.presenter.setBytes(Number(event.currentTarget.value))}
          />
        </label>
        <label class="grid content-start gap-1.5 text-base">
          <span>Encoding</span>
          <Select
            options={ENCODING_OPTIONS}
            value={props.presenter.encoding()}
            onChange={(value) => props.presenter.setEncoding(value)}
          />
        </label>
      </div>
      <Button variant="primary" onClick={() => void props.presenter.runRandom()}>
        Generate
      </Button>
      <Result
        value={props.presenter.random()}
        onCopy={(value) => void props.presenter.copy(value)}
      />
    </LayerCard>
  );
}

function UuidCard(props: { presenter: ToolsPresenter }): JSX.Element {
  const text = (): string => props.presenter.uuids().join("\n");
  return (
    <LayerCard class="grid gap-4 px-5 py-4">
      <CardTitle icon="database">UUID v7</CardTitle>
      <div class="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => void props.presenter.runUuid(1)}>
          One
        </Button>
        <Button variant="secondary" onClick={() => void props.presenter.runUuid(10)}>
          Ten
        </Button>
        <Show when={props.presenter.uuids().length > 0}>
          <Button
            variant="ghost"
            onClick={() => void props.presenter.copy(text())}
            class="ml-auto"
          >
            <Icon name="copy" class="h-3.5 w-3.5" />
            Copy all
          </Button>
        </Show>
      </div>
      <ul class="grid min-w-0 gap-1 font-mono text-sm">
        <For each={props.presenter.uuids()}>{(id) => <li class="truncate">{id}</li>}</For>
      </ul>
    </LayerCard>
  );
}

export default function ToolsView(): JSX.Element {
  const presenter = createToolsPresenter();
  return (
    <section class="grid gap-6">
      <PageHeader
        title="Tools"
        description="A scratchpad: hash a value, draw random bytes, mint a UUID. Nothing here is saved."
      />
      <div class="grid items-start gap-4 lg:grid-cols-3">
        <HashCard presenter={presenter} />
        <RandomCard presenter={presenter} />
        <UuidCard presenter={presenter} />
      </div>
    </section>
  );
}

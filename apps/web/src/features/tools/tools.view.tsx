import type { JSX } from "@solidjs/web";
import PageHeader from "@/components/page-header.tsx";
import { For, Show } from "solid-js";

import Button from "@/components/button.tsx";
import Input from "@/components/input.tsx";
import LayerCard from "@/components/layer-card.tsx";
import Select from "@/components/select.tsx";
import { ALGORITHMS, ENCODINGS, createToolsPresenter } from "./tools.presenter.ts";
import type { ToolsPresenter } from "./tools.presenter.ts";

const ALGORITHM_OPTIONS = ALGORITHMS.map((value) => ({ value, label: value }));
const ENCODING_OPTIONS = ENCODINGS.map((value) => ({ value, label: value }));

function Result(props: { value: string | null }): JSX.Element {
  return (
    <Show when={props.value}>
      {(value) => (
        <output class="block break-all rounded-md bg-kumo-tint px-3 py-2 font-mono text-sm">
          {value()}
        </output>
      )}
    </Show>
  );
}

function HashCard(props: { presenter: ToolsPresenter }): JSX.Element {
  return (
    <LayerCard class="grid gap-4 px-5 py-4">
      <div class="grid gap-1">
        <h3 class="font-medium">Hash</h3>
        <p class="text-kumo-subtle text-sm">
          The same functions column policies apply, so a hashed column never receives raw input.
        </p>
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="grid gap-1.5 text-sm">
          <span>Algorithm</span>
          <Select
            options={ALGORITHM_OPTIONS}
            value={props.presenter.algorithm()}
            onChange={(value) => props.presenter.setAlgorithm(value)}
          />
        </label>
        <label class="grid gap-1.5 text-sm">
          <span>Secret or seed (optional)</span>
          <Input
            type="password"
            autocomplete="off"
            value={props.presenter.secret()}
            onInput={(event) => props.presenter.setSecret(event.currentTarget.value)}
          />
        </label>
        <label class="grid gap-1.5 text-sm sm:col-span-2">
          <span>Value</span>
          <Input
            value={props.presenter.value()}
            onInput={(event) => props.presenter.setValue(event.currentTarget.value)}
          />
        </label>
      </div>
      <div>
        <Button variant="primary" onClick={() => void props.presenter.runHash()}>
          Hash
        </Button>
      </div>
      <Result value={props.presenter.hash()} />
    </LayerCard>
  );
}

function RandomCard(props: { presenter: ToolsPresenter }): JSX.Element {
  return (
    <LayerCard class="grid gap-4 px-5 py-4">
      <h3 class="font-medium">Random bytes</h3>
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="grid gap-1.5 text-sm">
          <span>Bytes (8 to 1024)</span>
          <Input
            type="number"
            min="8"
            max="1024"
            value={props.presenter.bytes()}
            onInput={(event) => props.presenter.setBytes(Number(event.currentTarget.value))}
          />
        </label>
        <label class="grid gap-1.5 text-sm">
          <span>Encoding</span>
          <Select
            options={ENCODING_OPTIONS}
            value={props.presenter.encoding()}
            onChange={(value) => props.presenter.setEncoding(value)}
          />
        </label>
      </div>
      <div>
        <Button variant="primary" onClick={() => void props.presenter.runRandom()}>
          Generate
        </Button>
      </div>
      <Result value={props.presenter.random()} />
    </LayerCard>
  );
}

function UuidCard(props: { presenter: ToolsPresenter }): JSX.Element {
  return (
    <LayerCard class="grid gap-4 px-5 py-4">
      <h3 class="font-medium">UUID v7</h3>
      <div class="flex gap-2">
        <Button variant="primary" onClick={() => void props.presenter.runUuid(1)}>
          One
        </Button>
        <Button variant="secondary" onClick={() => void props.presenter.runUuid(10)}>
          Ten
        </Button>
      </div>
      <ul class="grid gap-1 font-mono text-sm">
        <For each={props.presenter.uuids()}>{(id) => <li>{id}</li>}</For>
      </ul>
    </LayerCard>
  );
}

export default function ToolsView(): JSX.Element {
  const presenter = createToolsPresenter();
  return (
    <section class="grid gap-6">
      <PageHeader title="Tools" description="Generators for test data and credentials." />
      <HashCard presenter={presenter} />
      <RandomCard presenter={presenter} />
      <UuidCard presenter={presenter} />
    </section>
  );
}

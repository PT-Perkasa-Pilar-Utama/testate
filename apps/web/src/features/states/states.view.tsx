import type { JSX } from "@solidjs/web";
import { For, Loading, Show } from "solid-js";
import type { State, StateTreeNode } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import Button from "@/components/button.tsx";
import Switch from "@/components/switch.tsx";
import Tabs from "@/components/tabs.tsx";
import { Cell, Head, Row, Table } from "@/components/table.tsx";
import { hasRole } from "@/lib/session.ts";
import { createPreflightPresenter } from "../checkouts/preflight.presenter.ts";
import PreflightDialog from "../checkouts/preflight.view.tsx";
import { DeleteDialog, DetailDialog, EditDialog, TakeDialog } from "./states.dialogs.view.tsx";
import { formatBytes } from "./states.format.ts";
import { createStatesPresenter } from "./states.presenter.ts";
import type { StatesPresenter } from "./states.presenter.ts";

const VIEWS = [
  { id: "list", label: "List" },
  { id: "tree", label: "Tree" },
] as const;
const STATUS_VARIANT = { creating: "info", ready: "success", failed: "error" } as const;

function Branch(props: { nodes: StateTreeNode[] }): JSX.Element {
  return (
    <ul class="grid gap-1 border-l border-kumo-line pl-4">
      <For each={props.nodes}>
        {(node) => (
          <li class="grid gap-1">
            <span class="inline-flex items-center gap-2">
              {node.name}
              <Badge variant={node.kind === "init" ? "primary" : "outline"}>{node.kind}</Badge>
              <Show when={node.is_head}>
                <Badge variant="success">HEAD</Badge>
              </Show>
              <span class="text-kumo-subtle text-sm">
                {formatBytes(node.size_bytes)} · {node.created_at}
              </span>
            </span>
            <Show when={node.children.length > 0}>
              <Branch nodes={node.children} />
            </Show>
          </li>
        )}
      </For>
    </ul>
  );
}

function RowActions(props: {
  presenter: StatesPresenter;
  state: State;
  checkout: (state: State) => Promise<void>;
}): JSX.Element {
  return (
    <div class="flex flex-wrap justify-end gap-1">
      <Button
        size="sm"
        variant="ghost"
        onClick={() => void props.presenter.openDetail(props.state)}
      >
        Details
      </Button>
      <a
        class="inline-flex h-8 items-center rounded-lg px-3 text-sm hover:bg-kumo-tint"
        href={props.presenter.archiveUrl(props.state)}
      >
        Download
      </a>
      <Show when={hasRole("qa")}>
        <Button
          size="sm"
          variant="primary"
          disabled={props.state.status !== "ready"}
          onClick={() => void props.checkout(props.state)}
        >
          Check out
        </Button>
        <Button size="sm" variant="secondary" onClick={() => props.presenter.openEdit(props.state)}>
          Edit
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void props.presenter.setProtected(props.state, !props.state.protected)}
        >
          {props.state.protected ? "Unprotect" : "Protect"}
        </Button>
        <Button
          size="sm"
          variant="destructive"
          disabled={props.state.protected}
          onClick={() => props.presenter.openDelete(props.state)}
        >
          Delete
        </Button>
      </Show>
    </div>
  );
}

export default function StatesView(props: { slug: string; onChanged?: () => void }): JSX.Element {
  const presenter = createStatesPresenter(
    () => props.slug,
    () => props.onChanged?.()
  );
  const preflight = createPreflightPresenter(
    () => props.slug,
    () => {
      presenter.refresh();
      presenter.tree.refresh();
      props.onChanged?.();
    }
  );
  return (
    <div class="grid gap-4">
      <div class="flex items-center justify-between gap-4">
        <Tabs
          items={VIEWS}
          value={presenter.view()}
          onChange={(view) => presenter.setView(view)}
          label="States view"
        />
        <div class="flex items-center gap-4">
          <Switch
            label="Show stashes"
            checked={presenter.showStashes()}
            onChange={(value) => presenter.setShowStashes(value)}
          />
          <Show when={hasRole("qa")}>
            <Button variant="primary" onClick={() => presenter.openTake()}>
              Take state
            </Button>
          </Show>
        </div>
      </div>
      <Loading fallback={<p class="text-kumo-subtle">Loading states...</p>}>
        <Show when={presenter.view() === "tree"}>
          <Branch nodes={presenter.tree.value()} />
        </Show>
        <Show when={presenter.view() === "list"}>
          <Table>
            <thead>
              <tr>
                <Head>Name</Head>
                <Head>Kind</Head>
                <Head>Status</Head>
                <Head>Adapters</Head>
                <Head>Size</Head>
                <Head>By</Head>
                <Head>Taken</Head>
                <Head>Actions</Head>
              </tr>
            </thead>
            <tbody>
              <For each={presenter.value()}>
                {(state) => (
                  <Row>
                    <Cell>
                      <span class="inline-flex flex-wrap items-center gap-2">
                        {state.name}
                        <Show when={state.protected}>
                          <Badge variant="warning">protected</Badge>
                        </Show>
                        <For each={state.tags}>{(tag) => <Badge variant="info">{tag}</Badge>}</For>
                      </span>
                    </Cell>
                    <Cell>
                      <Badge variant={state.kind === "init" ? "primary" : "outline"}>
                        {state.kind}
                      </Badge>
                    </Cell>
                    <Cell>
                      <Badge variant={STATUS_VARIANT[state.status]}>{state.status}</Badge>
                    </Cell>
                    <Cell>{state.adapters.map((adapter) => adapter.adapter_name).join(", ")}</Cell>
                    <Cell>{formatBytes(state.size_bytes)}</Cell>
                    <Cell>{state.actor.label}</Cell>
                    <Cell>{state.created_at}</Cell>
                    <Cell>
                      <RowActions
                        presenter={presenter}
                        state={state}
                        checkout={(target) => preflight.open(target)}
                      />
                    </Cell>
                  </Row>
                )}
              </For>
            </tbody>
          </Table>
        </Show>
      </Loading>
      <TakeDialog presenter={presenter} />
      <EditDialog presenter={presenter} />
      <DeleteDialog presenter={presenter} />
      <DetailDialog presenter={presenter} />
      <PreflightDialog presenter={preflight} />
    </div>
  );
}

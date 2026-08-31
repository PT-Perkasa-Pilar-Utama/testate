import type { JSX } from "@solidjs/web";
import { formatWhen } from "@/lib/format.ts";
import { For, Loading, Show } from "solid-js";
import type { State, StateTreeNode } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import Button from "@/components/button.tsx";
import { Menu, MenuItem, MenuLink } from "@/components/menu.tsx";
import LoadMore from "@/components/load-more.tsx";
import Switch from "@/components/switch.tsx";
import Tabs from "@/components/tabs.tsx";
import { TableFooter } from "@/components/table.tsx";
import { hasRole } from "@/lib/session.ts";
import { createPreflightPresenter } from "../checkouts/preflight.presenter.ts";
import PreflightDialog from "../checkouts/preflight.view.tsx";
import { DeleteDialog, DetailDialog, EditDialog, TakeDialog } from "./states.dialogs.view.tsx";
import { formatBytes } from "./states.format.ts";
import { createStatesPresenter } from "./states.presenter.ts";
import Timeline from "./states.timeline.view.tsx";
import type { StatesPresenter } from "./states.presenter.ts";

const VIEWS = [
  { id: "list", label: "List" },
  { id: "tree", label: "Tree" },
] as const;
function Branch(props: { nodes: StateTreeNode[] }): JSX.Element {
  return (
    <ul class="grid gap-1 border-l border-line pl-4">
      <For each={props.nodes}>
        {(node) => (
          <li class="grid gap-1">
            <span class="inline-flex items-center gap-2">
              {node.name}
              <Badge variant={node.kind === "init" ? "primary" : "outline"}>{node.kind}</Badge>
              <Show when={node.is_head}>
                <Badge variant="success">HEAD</Badge>
              </Show>
              <span class="text-muted text-sm">
                {formatBytes(node.size_bytes)} · {formatWhen(node.created_at)}
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
    <div class="flex items-center justify-end gap-1">
      <Show
        when={hasRole("qa")}
        fallback={
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void props.presenter.openDetail(props.state)}
          >
            Details
          </Button>
        }
      >
        <Button
          size="sm"
          variant="primary"
          disabled={props.state.status !== "ready"}
          onClick={() => void props.checkout(props.state)}
        >
          Check out
        </Button>
      </Show>
      <Menu label={`Actions for ${props.state.name}`}>
        <Show when={hasRole("qa")}>
          <MenuItem onClick={() => void props.presenter.openDetail(props.state)}>Details</MenuItem>
        </Show>
        <MenuLink href={props.presenter.archiveUrl(props.state)}>Download</MenuLink>
        <Show when={hasRole("qa")}>
          <MenuItem onClick={() => props.presenter.openEdit(props.state)}>Edit</MenuItem>
          <MenuItem
            onClick={() => void props.presenter.setProtected(props.state, !props.state.protected)}
          >
            {props.state.protected ? "Unprotect" : "Protect"}
          </MenuItem>
          <MenuItem
            danger
            disabled={props.state.protected}
            onClick={() => props.presenter.openDelete(props.state)}
          >
            Delete
          </MenuItem>
        </Show>
      </Menu>
    </div>
  );
}

export default function StatesView(props: {
  slug: string;
  /** The state the databases are on; the timeline marks it HEAD. */
  headStateId?: string | null;
  onChanged?: () => void;
}): JSX.Element {
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
    <div class="grid gap-3">
      <div class="flex items-center justify-between gap-4">
        <Tabs
          items={VIEWS}
          value={presenter.view()}
          onChange={(view) => presenter.setView(view)}
          label="States view"
          variant="segmented"
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
      <Loading fallback={<p class="text-muted">Loading states...</p>}>
        <Show when={presenter.view() === "tree"}>
          <Branch nodes={presenter.tree.value()} />
        </Show>
        <Show when={presenter.view() === "list"}>
          <Timeline
            states={presenter.value()}
            headStateId={props.headStateId ?? null}
            actionsFor={(state) => (
              <RowActions
                presenter={presenter}
                state={state}
                checkout={(target) => preflight.open(target)}
              />
            )}
            empty="No states yet. Take one to keep what the databases hold right now."
          />
          <TableFooter shown={presenter.value().length} noun="states" hasMore={presenter.hasMore()}>
            <LoadMore when={presenter.hasMore()} onMore={() => presenter.loadMore()} />
          </TableFooter>
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

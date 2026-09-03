import type { JSX } from "@solidjs/web";
import { Loading, Show, untrack } from "solid-js";
import type { State } from "@testate/shared";

import Button from "@/components/button.tsx";
import Pending from "@/components/pending.tsx";
import Icon from "@/components/icon.tsx";
import { Menu, MenuItem, MenuLink } from "@/components/menu.tsx";
import LoadMore from "@/components/load-more.tsx";
import Switch from "@/components/switch.tsx";
import Tabs from "@/components/tabs.tsx";
import { TableFooter } from "@/components/table.tsx";
import { navigate } from "@/lib/router.ts";
import { hasRole } from "@/lib/session.ts";
import { createPreflightPresenter } from "../checkouts/preflight.presenter.ts";
import PreflightDialog from "../checkouts/preflight.view.tsx";
import CompareDialog from "./states.compare.view.tsx";
import { DeleteDialog, EditDialog } from "./states.dialogs.view.tsx";
import { statePath } from "./states.format.ts";
import { checkoutBlockedReason } from "./states.presenter.ts";
import Timeline from "./states.timeline.view.tsx";
import Tree from "./states.tree.view.tsx";
import type { StatesPresenter } from "./states.presenter.ts";

const VIEWS = [
  { id: "list", label: "List" },
  { id: "tree", label: "Tree" },
] as const;

function RowActions(props: {
  presenter: StatesPresenter;
  slug: string;
  state: State;
  /** This row is HEAD. */
  head: boolean;
  /** HEAD, verified and unmoved: the databases hold exactly this state. */
  atHead: boolean;
  checkout: (state: State) => Promise<void>;
}): JSX.Element {
  return (
    <div class="flex items-center justify-end gap-1">
      <Show when={hasRole("qa")}>
        {/* Quiet on the state the databases already hold, solid on every other: the button says
            where you are as well as where you can go. Never disabled, because an outside write
            Testate has not seen yet is exactly when a tester reaches for it. */}
        <Button
          size="sm"
          variant={props.atHead ? "accent-outline" : "outline"}
          disabled={props.state.status !== "ready"}
          title={
            checkoutBlockedReason(props.state) ??
            (props.atHead ? "The databases are on this state" : undefined)
          }
          onClick={() => void props.checkout(props.state)}
        >
          Check out
        </Button>
      </Show>
      {/* A stash is Testate's own safety net, taken before a restore or a write; it is read,
          downloaded and checked out, never renamed, protected or deleted by hand. */}
      <Menu label={`Actions for ${props.state.name}`}>
        <Show when={hasRole("qa") && props.head && props.state.kind !== "stash"}>
          <MenuItem onClick={() => void props.presenter.checkDrift(props.state)}>
            Check for changes
          </MenuItem>
        </Show>
        <MenuLink href={props.presenter.archiveUrl(props.state)}>Download</MenuLink>
        <Show when={hasRole("qa") && props.state.kind !== "stash"}>
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
  /** The project's own, shared with the header that takes states with it. */
  presenter: StatesPresenter;
  /** The state the databases are on; the timeline marks it HEAD. */
  headStateId?: string | null;
  /** A restore failed part way, so nobody knows what the databases hold; the row says so. */
  headUnknown?: boolean;
  /** The databases are known to have moved off HEAD (`head.dirty`). */
  headDirty?: boolean;
  onChanged?: () => void;
}): JSX.Element {
  // Read once: the project hands one presenter for its lifetime, so nothing tracks the prop.
  const presenter = untrack(() => props.presenter);
  const preflight = createPreflightPresenter(
    () => props.slug,
    () => {
      presenter.refresh();
      presenter.tree.refresh();
      props.onChanged?.();
    }
  );
  /** A tree node carries an id and not the whole state; the preflight wants the state. */
  const checkoutNode = async (id: string): Promise<void> => {
    await preflight.open(await presenter.byId(id));
  };
  // The diff lands in Activity, which is where every event about a state lives.
  const onCompare = async (): Promise<void> => {
    const staticSlug = props.slug;
    if (await presenter.compare())
      navigate(`/projects/${encodeURIComponent(staticSlug)}?tab=activity&show=diffs`);
  };
  const emptyText = (): string =>
    presenter.databases.value().length === 0
      ? "No databases yet. Connect one on the Databases tab; its first snapshot is the init state."
      : "No states yet. Take one to keep what the databases hold right now.";
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
        {/* Nothing to take or compare before a database is connected; the empty case says so. */}
        <Loading fallback={null}>
          <div class="flex items-center gap-4">
            <Switch
              label="Show stashes"
              checked={presenter.showStashes()}
              onChange={(value) => presenter.setShowStashes(value)}
            />
            {/* Take state sits in the project header now; Compare takes its place here. */}
            <Show when={hasRole("qa") && presenter.databases.value().length > 0}>
              <Button variant="secondary" onClick={() => presenter.openCompare()}>
                <Icon name="git-compare" class="h-4 w-4" />
                Compare
              </Button>
            </Show>
          </div>
        </Loading>
      </div>
      {/* Two ticked states are a comparison waiting to be asked for, which is where the New diff
          dialog used to ask the same question with two selects. */}
      <Show when={presenter.selected().length > 0}>
        <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-fill px-4 py-2.5 ring ring-line">
          <span class="text-base text-body">
            {presenter.selected().length === 1
              ? "1 state selected. Compare it with the live databases?"
              : "2 states selected."}
          </span>
          <div class="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => presenter.clearSelected()}>
              Clear
            </Button>
            <Button size="sm" variant="primary" onClick={() => void onCompare()}>
              {presenter.selected().length === 1 ? "Compare with live" : "Compare"}
            </Button>
          </div>
        </div>
      </Show>
      <Loading fallback={<Pending>Loading states...</Pending>}>
        <Show when={presenter.view() === "tree"}>
          <Tree
            nodes={presenter.tree.value()}
            empty={emptyText()}
            onOpen={(node) => navigate(statePath(props.slug, node.id))}
            actions={(node) => (
              <Show when={hasRole("qa")}>
                <Button
                  size="sm"
                  variant={node.is_head ? "accent-outline" : "outline"}
                  title={node.is_head ? "The databases are on this state" : undefined}
                  onClick={() => void checkoutNode(node.id)}
                >
                  Check out
                </Button>
              </Show>
            )}
          />
        </Show>
        <Show when={presenter.view() === "list"}>
          <Timeline
            slug={props.slug}
            states={presenter.value()}
            headStateId={props.headStateId ?? null}
            headUnknown={props.headUnknown === true}
            headDirty={props.headDirty === true}
            onPick={hasRole("qa") ? (id) => presenter.toggleSelected(id) : undefined}
            picked={presenter.selected()}
            actionsFor={(state) => (
              <RowActions
                slug={props.slug}
                presenter={presenter}
                state={state}
                head={state.id === props.headStateId}
                atHead={
                  state.id === props.headStateId &&
                  props.headUnknown !== true &&
                  props.headDirty !== true
                }
                checkout={(target) => preflight.open(target)}
              />
            )}
            empty={emptyText()}
          />
          <TableFooter
            shown={presenter.value().length}
            noun="states"
            hasMore={presenter.hasMore()}
            total={presenter.total()}
          >
            <LoadMore when={presenter.hasMore()} onMore={() => presenter.loadMore()} />
          </TableFooter>
        </Show>
      </Loading>
      <CompareDialog
        presenter={presenter}
        onDone={() =>
          navigate(`/projects/${encodeURIComponent(props.slug)}?tab=activity&show=diffs`)
        }
      />
      <EditDialog presenter={presenter} />
      <DeleteDialog presenter={presenter} />
      <PreflightDialog presenter={preflight} />
    </div>
  );
}

import { createSignal } from "solid-js";
import type {
  Adapter,
  JsonObject,
  State,
  StateListItem,
  StateDetail,
  StateDraftInput,
  StateTreeNode,
} from "@testate/shared";

import { humanMessage } from "@/lib/api-error.ts";
import { attempt, showToast } from "@/lib/toast.ts";
import { createPaged, createRefreshable } from "@/lib/async.ts";
import { remember, remembered } from "@/lib/remembered.ts";
import type { Paged, Refreshable } from "@/lib/async.ts";
import { createJobFollower } from "@/lib/sse.ts";
import { adaptersModel } from "../adapters/adapters.model.ts";
import { diffsModel } from "../diffs/diffs.model.ts";
import { LIVE } from "../diffs/diffs.presenter.ts";
import { statesModel } from "./states.model.ts";

export type StatesView = "list" | "tree";

export type StatesPresenter = Paged<StateListItem> & {
  tree: Refreshable<StateTreeNode[]>;
  databases: Refreshable<Adapter[]>;
  view: () => StatesView;
  setView: (view: StatesView) => void;
  showStashes: () => boolean;
  setShowStashes: (value: boolean) => void;
  taking: () => boolean;
  editing: () => State | null;
  deleting: () => State | null;
  detail: () => StateDetail | null;
  error: () => string | null;
  openTake: () => void;
  openEdit: (state: State) => void;
  openDelete: (state: State) => void;
  openDetail: (state: State) => Promise<void>;
  /** The same dialog from a tree node, which carries an id and not the whole state. */
  openDetailById: (id: string) => Promise<void>;
  /** The whole state behind a tree node: from the loaded list when it is there, else fetched. */
  byId: (id: string) => Promise<State>;
  close: () => void;
  take: (input: StateDraftInput) => Promise<void>;
  save: (input: StateDraftInput) => Promise<void>;
  setProtected: (state: State, value: boolean) => Promise<void>;
  confirmDelete: () => Promise<void>;
  archiveUrl: (state: State) => string;
  /** The states ticked for a comparison, in the order they were ticked. */
  selected: () => readonly string[];
  toggleSelected: (id: string) => void;
  clearSelected: () => void;
  /**
   * Two ticked compares them; one compares it with the live databases.
   *
   * It does not navigate. `lib/router.ts` reads `window` when it loads, so a presenter that
   * imports it cannot be tested outside a browser; where to go next is the view's answer anyway.
   */
  compare: () => Promise<boolean>;
  /** The Compare dialog: a base state and a target, the live databases or another state. */
  comparing: () => boolean;
  openCompare: () => void;
  closeCompare: () => void;
  compareWith: (base: string, target: string | null) => Promise<boolean>;
  /**
   * Diffs HEAD against the live databases, which is the one way an outside write can be seen, and
   * says what it found. The project's HEAD badge follows through `onChanged`.
   */
  checkDrift: (state: State) => Promise<void>;
};

/** "a, b,,a " -> ["a", "b"]. */
export function parseTags(text: string): string[] {
  return [
    ...new Set(
      text
        .split(",")
        .map((tag) => tag.trim())
        .filter((tag) => tag !== "")
    ),
  ];
}

/** The create body: every database adapter by default (story 62); `adapter_ids` only for a subset. */
export function toCreateBody(draft: StateDraftInput, databaseIds: string[]): JsonObject {
  const body: JsonObject = { name: draft.name.trim(), tags: parseTags(draft.tags) };
  if (draft.notes.trim() !== "") body["notes"] = draft.notes.trim();
  const subset = draft.adapter_ids.filter((id) => databaseIds.includes(id));
  if (subset.length > 0 && subset.length < databaseIds.length) body["adapter_ids"] = subset;
  return body;
}

export function toUpdateBody(draft: StateDraftInput): JsonObject {
  return {
    name: draft.name.trim(),
    notes: draft.notes.trim() === "" ? null : draft.notes.trim(),
    tags: parseTags(draft.tags),
  };
}

function messageOf(cause: unknown): string {
  return humanMessage(cause, "That did not work.");
}

/** Why "Check out" is dead for a state that is not ready, next to the button rather than a banner. */
export function checkoutBlockedReason(state: State): string | undefined {
  if (state.status === "creating") return "Still being taken.";
  if (state.status === "failed") return "This state failed and can't be restored.";
  return undefined;
}

export function createStatesPresenter(
  slug: () => string,
  onChanged: () => void = () => undefined
): StatesPresenter {
  // Created here, in the presenter's own body: the follower registers its cleanup with the
  // owner that is current at this moment, and there is none inside an effect or after an await.
  const jobs = createJobFollower();
  const [showStashes, setShowStashes] = createSignal(false);
  const states = createPaged((cursor) => statesModel.page(slug(), showStashes(), cursor));
  const tree = createRefreshable(() => statesModel.tree(slug()));
  const databases = createRefreshable(async () =>
    (await adaptersModel.list(slug())).filter((adapter) => adapter.kind === "database")
  );
  // Tree first: `parent_state_id` is the whole git analogy, and a stash hanging off the state it
  // protected is the thing a person came to see. List is the escape hatch.
  const [view, setViewSignal] = createSignal<StatesView>(
    remembered("states-view", ["list", "tree"], "tree")
  );
  const setView = (next: StatesView): void => {
    remember("states-view", next);
    setViewSignal(next);
  };
  const [taking, setTaking] = createSignal(false);
  const [editing, setEditing] = createSignal<State | null>(null);
  const [deleting, setDeleting] = createSignal<State | null>(null);
  const [detail, setDetail] = createSignal<StateDetail | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const refreshAll = (): void => {
    states.refresh();
    tree.refresh();
    onChanged();
  };
  const close = (): void => {
    setTaking(false);
    setEditing(null);
    setDeleting(null);
    setDetail(null);
    setError(null);
  };
  /** Dialog submits keep their error in the form instead of a toast. */
  const inForm = async (task: () => Promise<void>): Promise<void> => {
    setError(null);
    try {
      await task();
    } catch (cause: unknown) {
      setError(messageOf(cause));
    }
  };
  const [selected, setSelected] = createSignal<readonly string[]>([]);
  const [comparing, setComparing] = createSignal(false);
  const compareWith = async (base: string, targetId: string | null): Promise<boolean> => {
    const staticSlug = slug();
    const target = targetId === null ? LIVE : { state_id: targetId };
    let made = false;
    await attempt(async () => {
      await diffsModel.create(staticSlug, { base_state_id: base, target });
      showToast("Comparison started. It lands in Activity.", "info");
      setSelected([]);
      setComparing(false);
      made = true;
    });
    return made;
  };
  const openById = (id: string): Promise<void> => {
    const staticSlug = slug();
    return attempt(async () => {
      setDetail(await statesModel.get(staticSlug, id));
    });
  };
  return {
    ...states,
    tree,
    databases,
    view,
    setView,
    showStashes,
    setShowStashes,
    taking,
    editing,
    deleting,
    detail,
    error,
    openTake: () => {
      setError(null);
      setTaking(true);
    },
    openEdit: (state) => {
      setError(null);
      setEditing(state);
    },
    openDelete: (state) => {
      setError(null);
      setDeleting(state);
    },
    selected,
    toggleSelected: (id) =>
      setSelected((current) =>
        current.includes(id)
          ? current.filter((one) => one !== id)
          : // Two at a time: ticking a third drops the older of the two, which is what a person
            // means by ticking a third rather than an error to explain.
            [...current, id].slice(-2)
      ),
    clearSelected: () => setSelected([]),
    compare: () => {
      const staticPicked = selected();
      const base = staticPicked[0];
      // One ticked means "what has changed since", which is the live databases.
      return base === undefined
        ? Promise.resolve(false)
        : compareWith(base, staticPicked[1] ?? null);
    },
    comparing,
    openCompare: () => setComparing(true),
    closeCompare: () => setComparing(false),
    compareWith,
    checkDrift: async (state) => {
      const staticSlug = slug();
      await attempt(async () => {
        const { diff, job } = await diffsModel.create(staticSlug, {
          base_state_id: state.id,
          target: LIVE,
        });
        showToast(`Comparing ${state.name} with the live databases...`);
        await jobs.settle(job);
        const result = await diffsModel.get(staticSlug, diff.id);
        const moved = result.adapters.some((adapter) =>
          adapter.tables.some((table) => table.added + table.removed + table.changed > 0)
        );
        onChanged();
        showToast(
          moved
            ? `The databases have changed since ${state.name}.`
            : `The databases still match ${state.name}.`,
          moved ? "info" : "success"
        );
      });
    },
    openDetail: (state) => openById(state.id),
    openDetailById: (id) => openById(id),
    byId: (id) => {
      const loaded = states.value().find((state) => state.id === id);
      return loaded === undefined ? statesModel.get(slug(), id) : Promise.resolve(loaded);
    },
    close,
    take: (input) => {
      const staticSlug = slug();
      const staticBody = toCreateBody(
        input,
        databases.value().map((adapter) => adapter.id)
      );
      return inForm(async () => {
        const { state, job } = await statesModel.create(staticSlug, staticBody);
        close();
        refreshAll();
        showToast(`Snapshot ${state.name} queued`, "info");
        jobs.follow(job, (done) => {
          showToast(
            done.status === "succeeded"
              ? `State ${state.name} is ready`
              : `Snapshot ${state.name} ${done.status}`,
            done.status === "succeeded" ? "success" : "error"
          );
          refreshAll();
        });
      });
    },
    save: (input) => {
      const staticSlug = slug();
      const staticTarget = editing();
      const staticBody = toUpdateBody(input);
      if (staticTarget === null) return Promise.resolve();
      return inForm(async () => {
        await statesModel.update(staticSlug, staticTarget.id, staticBody);
        showToast("State updated.", "success");
        close();
        refreshAll();
      });
    },
    setProtected: (state, value) => {
      const staticSlug = slug();
      return attempt(async () => {
        await statesModel.update(staticSlug, state.id, { protected: value });
        showToast(
          value ? `${state.name} is protected.` : `${state.name} is no longer protected.`,
          "success"
        );
        states.refresh();
      });
    },
    confirmDelete: () => {
      const staticSlug = slug();
      const staticTarget = deleting();
      if (staticTarget === null) return Promise.resolve();
      return inForm(async () => {
        const job = await statesModel.remove(staticSlug, staticTarget.id);
        close();
        showToast(`Deleting ${staticTarget.name}`, "info");
        jobs.follow(job, refreshAll);
      });
    },
    archiveUrl: (state) => statesModel.archiveUrl(slug(), state.id),
  };
}

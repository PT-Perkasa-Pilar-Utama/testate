import { createSignal } from "solid-js";
import type {
  Adapter,
  JsonObject,
  State,
  StateDetail,
  StateDraftInput,
  StateTreeNode,
} from "@testate/shared";

import { humanMessage } from "@/lib/api-error.ts";
import { attempt, showToast } from "@/lib/toast.ts";
import { createPaged, createRefreshable } from "@/lib/async.ts";
import type { Paged, Refreshable } from "@/lib/async.ts";
import { followJob } from "@/lib/sse.ts";
import { adaptersModel } from "../adapters/adapters.model.ts";
import { statesModel } from "./states.model.ts";

export type StatesView = "list" | "tree";

export type StatesPresenter = Paged<State> & {
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
  close: () => void;
  take: (input: StateDraftInput) => Promise<void>;
  save: (input: StateDraftInput) => Promise<void>;
  setProtected: (state: State, value: boolean) => Promise<void>;
  confirmDelete: () => Promise<void>;
  archiveUrl: (state: State) => string;
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
  const [showStashes, setShowStashes] = createSignal(false);
  const states = createPaged((cursor) => statesModel.page(slug(), showStashes(), cursor));
  const tree = createRefreshable(() => statesModel.tree(slug()));
  const databases = createRefreshable(async () =>
    (await adaptersModel.list(slug())).filter((adapter) => adapter.kind === "database")
  );
  const [view, setView] = createSignal<StatesView>("list");
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
    openDetail: (state) => {
      const staticSlug = slug();
      return attempt(async () => {
        setDetail(await statesModel.get(staticSlug, state.id));
      });
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
        followJob(job, (done) => {
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
        close();
        refreshAll();
      });
    },
    setProtected: (state, value) => {
      const staticSlug = slug();
      return attempt(async () => {
        await statesModel.update(staticSlug, state.id, { protected: value });
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
        followJob(job, refreshAll);
      });
    },
    archiveUrl: (state) => statesModel.archiveUrl(slug(), state.id),
  };
}

import { createSignal } from "solid-js";
import type { Adapter, JsonObject, State, StateDetail, StateTreeNode } from "@testate/shared";

import { attempt, showToast } from "@/lib/toast.ts";
import { createPaged, createRefreshable } from "@/lib/async.ts";
import type { Paged, Refreshable } from "@/lib/async.ts";
import { followJob } from "@/lib/sse.ts";
import { adaptersModel } from "../adapters/adapters.model.ts";
import { statesModel } from "./states.model.ts";

export type StateDraft = { name: string; notes: string; tags: string; adapter_ids: string[] };
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
  draft: () => StateDraft;
  error: () => string | null;
  openTake: () => void;
  openEdit: (state: State) => void;
  openDelete: (state: State) => void;
  openDetail: (state: State) => Promise<void>;
  close: () => void;
  setDraft: (patch: Partial<StateDraft>) => void;
  toggleAdapter: (id: string) => void;
  take: () => Promise<void>;
  save: () => Promise<void>;
  setProtected: (state: State, value: boolean) => Promise<void>;
  confirmDelete: () => Promise<void>;
  archiveUrl: (state: State) => string;
};

const EMPTY: StateDraft = { name: "", notes: "", tags: "", adapter_ids: [] };

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
export function toCreateBody(draft: StateDraft, databaseIds: string[]): JsonObject {
  const body: JsonObject = { name: draft.name.trim(), tags: parseTags(draft.tags) };
  if (draft.notes.trim() !== "") body["notes"] = draft.notes.trim();
  const subset = draft.adapter_ids.filter((id) => databaseIds.includes(id));
  if (subset.length > 0 && subset.length < databaseIds.length) body["adapter_ids"] = subset;
  return body;
}

export function toUpdateBody(draft: StateDraft): JsonObject {
  return {
    name: draft.name.trim(),
    notes: draft.notes.trim() === "" ? null : draft.notes.trim(),
    tags: parseTags(draft.tags),
  };
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : "request failed";
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
  const [draft, setDraftSignal] = createSignal<StateDraft>(EMPTY);
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
    draft,
    error,
    openTake: () => {
      setDraftSignal(EMPTY);
      setError(null);
      setTaking(true);
    },
    openEdit: (state) => {
      setDraftSignal({
        name: state.name,
        notes: state.notes ?? "",
        tags: state.tags.join(", "),
        adapter_ids: [],
      });
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
    setDraft: (patch) => setDraftSignal((current) => ({ ...current, ...patch })),
    toggleAdapter: (id) =>
      setDraftSignal((current) => ({
        ...current,
        adapter_ids: current.adapter_ids.includes(id)
          ? current.adapter_ids.filter((other) => other !== id)
          : [...current.adapter_ids, id],
      })),
    take: () => {
      const staticSlug = slug();
      const staticBody = toCreateBody(
        draft(),
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
    save: () => {
      const staticSlug = slug();
      const staticTarget = editing();
      const staticBody = toUpdateBody(draft());
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

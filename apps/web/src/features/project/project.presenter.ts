import { createSignal } from "solid-js";
import type { JsonObject } from "@testate/shared";

import { attempt, showToast } from "@/lib/toast.ts";
import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { navigate, search } from "@/lib/router.ts";
import { hasRole } from "@/lib/session.ts";
import { projectsModel } from "../projects/projects.model.ts";
import type { DeletionPlan, Overview } from "../projects/projects.model.ts";

/**
 * The work first, the plumbing last. This used to open on Adapters, which is the one tab a tester
 * never needs: an admin connects the database once and nobody touches it again.
 *
 * "Checkouts" is called History because the tab cannot start one. Check out is a button on a state,
 * which is where a person looks for it, and the tab is where you go when a restore went wrong.
 */
export const PROJECT_TABS = [
  { id: "states", label: "States" },
  { id: "imports", label: "Imports" },
  { id: "diffs", label: "Diffs" },
  { id: "checkouts", label: "History" },
  { id: "adapters", label: "Adapters" },
] as const;
export type ProjectTab = (typeof PROJECT_TABS)[number]["id"];

const TAB_IDS: readonly string[] = PROJECT_TABS.map((tab) => tab.id);
const DEFAULT_TAB: ProjectTab = "states";

export type ProjectDraft = { name: string; description: string; quota_gib: string };

export type ProjectPresenter = {
  overview: Refreshable<Overview>;
  tab: () => ProjectTab;
  setTab: (tab: ProjectTab) => void;
  editing: () => boolean;
  draft: () => ProjectDraft;
  openEdit: () => void;
  closeEdit: () => void;
  setDraft: (patch: Partial<ProjectDraft>) => void;
  save: () => Promise<void>;
  plan: () => DeletionPlan | null;
  confirmSlug: () => string;
  setConfirmSlug: (value: string) => void;
  openDelete: () => Promise<void>;
  closeDelete: () => void;
  confirmDelete: () => Promise<void>;
};

const GIB = 1024 * 1024 * 1024;

/** The edit body: qa sends name and description; only an admin's draft carries the quota. */
export function toUpdateBody(draft: ProjectDraft, admin: boolean): JsonObject {
  const body: JsonObject = { name: draft.name.trim() };
  body["description"] = draft.description.trim() === "" ? null : draft.description.trim();
  if (admin)
    body["quota_bytes"] = draft.quota_gib === "" ? null : Math.round(Number(draft.quota_gib) * GIB);
  return body;
}

export function createProjectPresenter(slug: () => string): ProjectPresenter {
  const overview = createRefreshable(() => projectsModel.overview(slug()));
  /**
   * The tab lives in the URL, not in a signal. A signal meant a reload always landed on the first
   * tab and a tab could not be sent to anyone. `search` is a signal, so this stays reactive.
   */
  const tab = (): ProjectTab => {
    const wanted = new URLSearchParams(search()).get("tab") ?? "";
    // SAFETY: the membership test above narrows `wanted` to one of the literal ids.
    return TAB_IDS.includes(wanted) ? (wanted as ProjectTab) : DEFAULT_TAB;
  };
  // Pushed, not replaced, so Back walks the tabs instead of leaving the project.
  const setTab = (next: ProjectTab): void =>
    navigate(`/projects/${encodeURIComponent(slug())}?tab=${next}`);
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraftSignal] = createSignal<ProjectDraft>({
    name: "",
    description: "",
    quota_gib: "",
  });
  const [plan, setPlan] = createSignal<DeletionPlan | null>(null);
  const [confirmSlug, setConfirmSlug] = createSignal("");
  return {
    overview,
    tab,
    setTab,
    editing,
    draft,
    openEdit: () => {
      const current = overview.value().project;
      setDraftSignal({
        name: current.name,
        description: current.description ?? "",
        quota_gib: current.quota_bytes === null ? "" : String(current.quota_bytes / GIB),
      });
      setEditing(true);
    },
    closeEdit: () => setEditing(false),
    setDraft: (patch) => setDraftSignal((current) => ({ ...current, ...patch })),
    save: () => {
      const staticBody = toUpdateBody(draft(), hasRole("admin"));
      const staticSlug = slug();
      return attempt(async () => {
        await projectsModel.update(staticSlug, staticBody);
        setEditing(false);
        overview.refresh();
      });
    },
    plan,
    confirmSlug,
    setConfirmSlug,
    openDelete: () => {
      const staticSlug = slug();
      setConfirmSlug("");
      return attempt(async () => {
        setPlan(await projectsModel.deletionPlan(staticSlug));
      });
    },
    closeDelete: () => setPlan(null),
    confirmDelete: () => {
      const staticPlan = plan();
      const staticSlug = slug();
      const staticConfirm = confirmSlug();
      if (staticPlan === null) return Promise.resolve();
      return attempt(async () => {
        await projectsModel.deleteProject(staticSlug, {
          confirm_slug: staticConfirm,
          plan_id: staticPlan.plan_id,
          adapters: staticPlan.adapters
            .filter((adapter) => adapter.action !== "none")
            .map((adapter) => ({
              adapter_id: adapter.adapter_id,
              action: adapter.action === "skip" ? "skip" : "restore",
            })),
        });
        setPlan(null);
        showToast("Deletion job queued; every database returns to its init state first", "info");
        navigate("/projects");
      });
    },
  };
}

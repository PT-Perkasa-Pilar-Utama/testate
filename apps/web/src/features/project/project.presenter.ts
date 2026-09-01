import { createSignal } from "solid-js";
import type { JsonObject, Project, ProjectDraft } from "@testate/shared";

import { humanMessage } from "@/lib/api-error.ts";
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

/**
 * The edit and delete forms hold their own fields now (`projectDraftSchema` and, for the confirm
 * slug, a check built against the project being deleted); this holds what only the server can
 * answer, such as a refused connection, which is why edit and delete each keep their own error.
 */
export type ProjectPresenter = {
  overview: Refreshable<Overview>;
  tab: () => ProjectTab;
  setTab: (tab: ProjectTab) => void;
  editing: () => boolean;
  editError: () => string | null;
  openEdit: () => void;
  closeEdit: () => void;
  save: (draft: ProjectDraft) => Promise<void>;
  plan: () => DeletionPlan | null;
  deleteError: () => string | null;
  openDelete: () => Promise<void>;
  closeDelete: () => void;
  confirmDelete: (confirmSlug: string) => Promise<void>;
};

const GIB = 1024 * 1024 * 1024;

/** The current project, as the edit form's initial values. */
/**
 * The edit form's shape before the project loads. `EditDialog` is rendered outside the `<Loading>`
 * that waits for the overview, so building its form from `overview.value()` read a promise that was
 * still pending: the screen re-ran to wait for it, rebuilt the presenter, asked again, and the
 * production bundle spun on that at one request per round trip. The dialog only opens from inside
 * the boundary, so its effect resets to the real project before anyone sees these blanks.
 */
export const PROJECT_BLANK: ProjectDraft = { name: "", description: "", quota_gib: "" };

export function toProjectDraft(project: Project): ProjectDraft {
  return {
    name: project.name,
    description: project.description ?? "",
    quota_gib: project.quota_bytes === null ? "" : String(project.quota_bytes / GIB),
  };
}

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
  const [editError, setEditError] = createSignal<string | null>(null);
  const [plan, setPlan] = createSignal<DeletionPlan | null>(null);
  const [deleteError, setDeleteError] = createSignal<string | null>(null);
  return {
    overview,
    tab,
    setTab,
    editing,
    editError,
    openEdit: () => setEditing(true),
    closeEdit: () => {
      setEditing(false);
      setEditError(null);
    },
    save: async (draft) => {
      const staticBody = toUpdateBody(draft, hasRole("admin"));
      const staticSlug = slug();
      setEditError(null);
      try {
        await projectsModel.update(staticSlug, staticBody);
        setEditing(false);
        overview.refresh();
      } catch (cause: unknown) {
        setEditError(humanMessage(cause, "Could not update the project."));
      }
    },
    plan,
    deleteError,
    openDelete: () => {
      const staticSlug = slug();
      return attempt(async () => {
        setPlan(await projectsModel.deletionPlan(staticSlug));
      });
    },
    closeDelete: () => {
      setPlan(null);
      setDeleteError(null);
    },
    confirmDelete: async (confirmSlug) => {
      const staticPlan = plan();
      const staticSlug = slug();
      if (staticPlan === null) return;
      setDeleteError(null);
      try {
        await projectsModel.deleteProject(staticSlug, {
          confirm_slug: confirmSlug,
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
      } catch (cause: unknown) {
        setDeleteError(humanMessage(cause, "Could not delete the project."));
      }
    },
  };
}

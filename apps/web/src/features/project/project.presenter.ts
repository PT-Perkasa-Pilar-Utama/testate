import { createSignal } from "solid-js";
import type { JsonObject, Project, ProjectDefaults, ProjectDraft } from "@testate/shared";

import { humanMessage } from "@/lib/api-error.ts";
import { attempt, showToast } from "@/lib/toast.ts";
import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { navigate, search } from "@/lib/router.ts";
import { hasRole } from "@/lib/session.ts";
import { QUOTA_STEPS, quotaIndex } from "../projects/projects.presenter.ts";
import { projectsModel } from "../projects/projects.model.ts";
import type { DeletionPlan, Overview } from "../projects/projects.model.ts";

/**
 * The work first, the plumbing last. This used to open on Adapters, which is the one tab a tester
 * never needs: an admin connects the database once and nobody touches it again.
 *
 * Three, not five. States is the front door; Activity holds the events that reference a state,
 * which is what checkouts, diffs and import runs all are; Databases holds the connections.
 * File stores are not here at all: they have their own menu.
 */
export const PROJECT_TABS = [
  { id: "states", label: "States" },
  { id: "activity", label: "Activity" },
  { id: "adapters", label: "Databases" },
] as const;
export type ProjectTab = (typeof PROJECT_TABS)[number]["id"];

const TAB_IDS: readonly string[] = PROJECT_TABS.map((tab) => tab.id);
const DEFAULT_TAB: ProjectTab = "states";

/**
 * Where the old tabs went.
 *
 * Checkouts, diffs and import runs are all the same kind of thing: an event with a job, a status
 * and a link back to the states it touched. A link somebody bookmarked or a test wrote still
 * lands on the right screen (docs/PROJECT_REWORK.md).
 */
const MOVED = new Map<string, ProjectTab>([
  ["checkouts", "activity"],
  ["diffs", "activity"],
  ["imports", "activity"],
]);

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
  /** The quota slider's step, seeded from the project each time the dialog opens. */
  quotaIndex: () => number;
  setQuotaIndex: (index: number) => void;
  defaults: Refreshable<ProjectDefaults>;
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

/** The current project, as the edit form's initial values. */
/**
 * The edit form's shape before the project loads. `EditDialog` is rendered outside the `<Loading>`
 * that waits for the overview, so building its form from `overview.value()` read a promise that was
 * still pending: the screen re-ran to wait for it, rebuilt the presenter, asked again, and the
 * production bundle spun on that at one request per round trip. The dialog only opens from inside
 * the boundary, so its effect resets to the real project before anyone sees these blanks.
 */
export const PROJECT_BLANK: ProjectDraft = { name: "", description: "" };

export function toProjectDraft(project: Project): ProjectDraft {
  return { name: project.name, description: project.description ?? "" };
}

/** The edit body: qa sends name and description; only an admin's draft carries the quota. */
/** `quota` is the slider's step, and only an admin's dialog shows it, so only theirs sends it. */
export function toUpdateBody(
  draft: ProjectDraft,
  quota: number | null,
  admin: boolean
): JsonObject {
  const body: JsonObject = { name: draft.name.trim() };
  body["description"] = draft.description.trim() === "" ? null : draft.description.trim();
  if (admin) body["quota_bytes"] = quota;
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
    if (!TAB_IDS.includes(wanted)) return MOVED.get(wanted) ?? DEFAULT_TAB;
    // SAFETY: the membership test above narrows `wanted` to one of the literal ids.
    return wanted as ProjectTab;
  };
  // Pushed, not replaced, so Back walks the tabs instead of leaving the project.
  const setTab = (next: ProjectTab): void =>
    navigate(`/projects/${encodeURIComponent(slug())}?tab=${next}`);
  const [editing, setEditing] = createSignal(false);
  const [quota, setQuota] = createSignal(0);
  const defaults = createRefreshable(() => projectsModel.defaults());
  const [editError, setEditError] = createSignal<string | null>(null);
  const [plan, setPlan] = createSignal<DeletionPlan | null>(null);
  const [deleteError, setDeleteError] = createSignal<string | null>(null);
  return {
    overview,
    tab,
    setTab,
    editing,
    editError,
    quotaIndex: quota,
    setQuotaIndex: setQuota,
    defaults,
    openEdit: () => {
      setQuota(quotaIndex(overview.value().project.quota_bytes));
      setEditing(true);
    },
    closeEdit: () => {
      setEditing(false);
      setEditError(null);
    },
    save: async (draft) => {
      const staticBody = toUpdateBody(draft, QUOTA_STEPS[quota()] ?? null, hasRole("admin"));
      const staticSlug = slug();
      setEditError(null);
      try {
        await projectsModel.update(staticSlug, staticBody);
        showToast("Project updated.", "success");
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
        showToast("Project deleted.", "success");
        setPlan(null);
        showToast("Deletion job queued; every database returns to its init state first", "info");
        navigate("/projects");
      } catch (cause: unknown) {
        setDeleteError(humanMessage(cause, "Could not delete the project."));
      }
    },
  };
}

import { createSignal } from "solid-js";
import type { JsonObject, Project, Quota } from "@testate/shared";

import { attempt, showToast } from "@/lib/toast.ts";
import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { navigate } from "@/lib/router.ts";
import { hasRole } from "@/lib/session.ts";
import { projectsModel } from "../projects/projects.model.ts";
import type { DeletionPlan } from "../projects/projects.model.ts";

export const PROJECT_TABS = [
  { id: "adapters", label: "Adapters" },
  { id: "states", label: "States" },
  { id: "checkouts", label: "Checkouts" },
  { id: "diffs", label: "Diffs" },
  { id: "imports", label: "Imports" },
] as const;
export type ProjectTab = (typeof PROJECT_TABS)[number]["id"];

export type ProjectDraft = { name: string; description: string; quota_gib: string };

export type ProjectPresenter = {
  project: Refreshable<Project>;
  quota: Refreshable<Quota>;
  tab: () => ProjectTab;
  setTab: (tab: ProjectTab) => void;
  usedPercent: () => number;
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
  const project = createRefreshable(() => projectsModel.get(slug()));
  const quota = createRefreshable(() => projectsModel.quota(slug()));
  const [tab, setTab] = createSignal<ProjectTab>("adapters");
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraftSignal] = createSignal<ProjectDraft>({
    name: "",
    description: "",
    quota_gib: "",
  });
  const [plan, setPlan] = createSignal<DeletionPlan | null>(null);
  const [confirmSlug, setConfirmSlug] = createSignal("");
  return {
    project,
    quota,
    tab,
    setTab,
    usedPercent: () => {
      const current = quota.value();
      return current.quota_bytes === 0
        ? 0
        : Math.min(100, Math.round((current.used_bytes / current.quota_bytes) * 100));
    },
    editing,
    draft,
    openEdit: () => {
      const current = project.value();
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
        project.refresh();
        quota.refresh();
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

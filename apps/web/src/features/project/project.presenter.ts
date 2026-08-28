import { createSignal } from "solid-js";
import type { Project, Quota } from "@testate/shared";

import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { projectsModel } from "../projects/projects.model.ts";

export const PROJECT_TABS = [
  { id: "adapters", label: "Adapters" },
  { id: "states", label: "States" },
  { id: "checkouts", label: "Checkouts" },
  { id: "diffs", label: "Diffs" },
  { id: "imports", label: "Imports" },
  { id: "hooks", label: "Hooks" },
] as const;
export type ProjectTab = (typeof PROJECT_TABS)[number]["id"];

export type ProjectPresenter = {
  project: Refreshable<Project>;
  quota: Refreshable<Quota>;
  tab: () => ProjectTab;
  setTab: (tab: ProjectTab) => void;
  usedPercent: () => number;
};

export function createProjectPresenter(slug: () => string): ProjectPresenter {
  const project = createRefreshable(() => projectsModel.get(slug()));
  const quota = createRefreshable(() => projectsModel.quota(slug()));
  const [tab, setTab] = createSignal<ProjectTab>("adapters");
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
  };
}

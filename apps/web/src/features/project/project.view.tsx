import type { JSX } from "@solidjs/web";
import { Loading, Match, Show, Switch } from "solid-js";

import Badge from "@/components/badge.tsx";
import Breadcrumbs from "@/components/breadcrumbs.tsx";
import Button from "@/components/button.tsx";
import Icon from "@/components/icon.tsx";
import Meter from "@/components/meter.tsx";
import Tabs from "@/components/tabs.tsx";
import { hasRole } from "@/lib/session.ts";
import AdaptersView from "../adapters/adapters.view.tsx";
import ActivityView from "./activity.view.tsx";
import StatesView from "../states/states.view.tsx";
import { formatBytes } from "../states/states.format.ts";
import { headBadge, quotaTone } from "../projects/projects.format.ts";
import { DeleteDialog, EditDialog } from "./project-settings.view.tsx";
import type { ProjectPresenter } from "./project.presenter.ts";
import { PROJECT_TABS, createProjectPresenter } from "./project.presenter.ts";

/** A compact bar that only reaches for colour once the quota is actually worth worrying about. */
function QuotaChip(props: { presenter: ProjectPresenter }): JSX.Element {
  const quota = () => props.presenter.overview.value().quota;
  const tone = () => quotaTone(quota());
  return (
    <div class="ml-auto flex w-full max-w-[180px] items-center gap-1.5">
      <Show when={tone() !== "default"}>
        <Icon
          name="triangle-alert"
          class={tone() === "danger" ? "h-3.5 w-3.5 text-danger-fg" : "h-3.5 w-3.5 text-warning-fg"}
        />
      </Show>
      <Meter
        value={quota().used_bytes}
        max={quota().quota_bytes}
        tone={tone()}
        label="Quota"
        detail={`${formatBytes(quota().used_bytes)} of ${formatBytes(quota().quota_bytes)}`}
      />
    </div>
  );
}

/**
 * Identity first, state second, actions third: name and slug read top-left the way a repository's
 * do, Edit and Delete sit quiet at top-right because they are rare next to the tabs below, and HEAD
 * plus the quota only speak up when there is something to say.
 */
function ProjectHeader(props: { presenter: ProjectPresenter }): JSX.Element {
  const project = () => props.presenter.overview.value().project;
  const banner = () => props.presenter.overview.value().banner;
  const badge = () => headBadge(project().head);
  return (
    <div class="grid gap-3 border-b border-line pb-4">
      <Breadcrumbs items={[{ label: "Projects", href: "/projects" }, { label: project().slug }]} />
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="grid gap-1.5">
          <div class="flex flex-wrap items-baseline gap-2">
            <h2 class="text-2xl font-semibold tracking-tight text-heading">{project().name}</h2>
            <code class="text-sm text-muted">{project().slug}</code>
          </div>
          <Show when={project().description}>
            <p class="text-muted">{project().description}</p>
          </Show>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <Show when={hasRole("qa")}>
            <Button size="sm" variant="secondary" onClick={() => props.presenter.openEdit()}>
              Edit
            </Button>
          </Show>
          <Show when={hasRole("admin")}>
            <Button size="sm" variant="outline" onClick={() => void props.presenter.openDelete()}>
              Delete
            </Button>
          </Show>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <span class="text-xs text-muted">HEAD</span>
        <Badge variant={badge().tone}>{badge().label}</Badge>
        <Show when={banner()}>
          {(info) => (
            <span class="inline-flex items-center gap-1.5 text-xs text-warning-fg">
              <Icon name="triangle-alert" class="h-3.5 w-3.5" />
              {info().message}
            </span>
          )}
        </Show>
        <QuotaChip presenter={props.presenter} />
      </div>
    </div>
  );
}

export default function ProjectView(props: { slug: string }): JSX.Element {
  const presenter = createProjectPresenter(() => props.slug);
  return (
    <section class="grid gap-5">
      <Loading fallback={<p class="text-muted">Loading project...</p>}>
        <ProjectHeader presenter={presenter} />
      </Loading>
      <Tabs
        items={PROJECT_TABS}
        value={presenter.tab()}
        onChange={(tab) => presenter.setTab(tab)}
        label="Project sections"
      />
      <Switch>
        <Match when={presenter.tab() === "adapters"}>
          <AdaptersView slug={props.slug} />
        </Match>
        <Match when={presenter.tab() === "states"}>
          <StatesView
            slug={props.slug}
            headStateId={presenter.overview.value().project.head.state_id}
            headUnknown={presenter.overview.value().project.head.status === "unknown"}
            onChanged={() => presenter.overview.refresh()}
          />
        </Match>
        <Match when={presenter.tab() === "activity"}>
          <ActivityView slug={props.slug} onChanged={() => presenter.overview.refresh()} />
        </Match>
      </Switch>
      <EditDialog presenter={presenter} />
      <DeleteDialog presenter={presenter} slug={props.slug} />
    </section>
  );
}

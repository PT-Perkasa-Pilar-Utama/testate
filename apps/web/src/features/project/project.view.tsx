import type { JSX } from "@solidjs/web";
import { Loading, Match, Show, Switch, createSignal, untrack } from "solid-js";

import Badge from "@/components/badge.tsx";
import Pending from "@/components/pending.tsx";
import Breadcrumbs from "@/components/breadcrumbs.tsx";
import Button from "@/components/button.tsx";
import Icon from "@/components/icon.tsx";
import { Menu, MenuItem } from "@/components/menu.tsx";
import Meter from "@/components/meter.tsx";
import Tabs from "@/components/tabs.tsx";
import { hasRole } from "@/lib/session.ts";
import EmptyState from "@/components/empty-state.tsx";
import { navigate } from "@/lib/router.ts";
import ActivityView from "./activity.view.tsx";
import ConnectionCounts from "./project.counts.view.tsx";
import InspectProject from "./inspect.view.tsx";
import StatesView from "../states/states.view.tsx";
import { TakeDialog } from "../states/states.dialogs.view.tsx";
import { formatBytes } from "../states/states.format.ts";
import { createStatesPresenter } from "../states/states.presenter.ts";
import type { StatesPresenter } from "../states/states.presenter.ts";
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
function ProjectHeader(props: {
  presenter: ProjectPresenter;
  states: StatesPresenter;
}): JSX.Element {
  const project = () => props.presenter.overview.value().project;
  // The shutter: a flash over the button for the length of one blink, then the dialog.
  const [snapping, setSnapping] = createSignal(false);
  const snap = (): void => {
    setSnapping(true);
    setTimeout(() => setSnapping(false), 450);
    props.states.openTake();
  };
  const banner = () => props.presenter.overview.value().banner;
  const badge = () => headBadge(project().head);
  return (
    <div class="grid gap-3 border-b border-line pb-4">
      {/* The name, not the slug: the slug is printed beside the heading already, and one string
          in two places is two matches for anything that looks for it. */}
      <Breadcrumbs items={[{ label: "Projects", href: "/projects" }, { label: project().name }]} />
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="grid gap-1.5">
          <div class="flex flex-wrap items-baseline gap-2">
            <h2 class="text-2xl font-semibold tracking-tight text-heading">{project().name}</h2>
            <code class="text-sm text-muted">{project().slug}</code>
          </div>
          <Show when={project().description}>
            <p class="text-muted">{project().description}</p>
          </Show>
          <ConnectionCounts
            slug={project().slug}
            adapters={props.presenter.overview.value().adapters}
          />
        </div>
        <div class="flex shrink-0 items-center gap-2">
          {/* The product's own verb, on every tab: a state is of the project, not of a tab. It
              waits for a database to exist, since there is nothing to take before one. */}
          <Show when={hasRole("qa") && props.states.databases.value().length > 0}>
            <span class={["orbit", snapping() ? "shutter" : ""]}>
              <Button size="lg" variant="accent" onClick={() => snap()}>
                <Icon name="camera" class="aim h-5 w-5" />
                Snapshot
              </Button>
            </span>
          </Show>
          {/* Settings behind a gear: Edit and Delete are rare, and beside the product's verb they
              read as three equals. */}
          <Show when={hasRole("qa")}>
            <Menu
              label="Project settings"
              trigger={
                <span class="inline-flex h-10 w-10 items-center justify-center rounded-md ring ring-line hover:bg-hover">
                  <Icon name="settings" class="h-5 w-5" />
                </span>
              }
            >
              <MenuItem onClick={() => props.presenter.openEdit()}>Edit</MenuItem>
              <Show when={hasRole("admin")}>
                <MenuItem danger onClick={() => void props.presenter.openDelete()}>
                  Delete
                </MenuItem>
              </Show>
            </Menu>
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

/** Every project people make: header, Snapshot, the three tabs and the settings dialogs. */
function RegularProject(props: { presenter: ProjectPresenter; slug: string }): JSX.Element {
  // The presenter is made once by the page and never replaced, so reading it here is not a loss
  // of tracking: there is no later value to miss.
  const presenter = untrack(() => props.presenter);
  // One states presenter for the project: the header takes a state with it, the States tab lists
  // with it, and a state taken from Activity still lands in the list when the tab is opened.
  const states = createStatesPresenter(
    () => props.slug,
    () => presenter.overview.refresh()
  );
  const [iris, setIris] = createSignal(false);
  /** Resolves once the iris has closed and opened again: the take waits for it. */
  const shutter = (): Promise<void> =>
    new Promise((resolve) => {
      setIris(true);
      setTimeout(() => {
        setIris(false);
        resolve();
      }, 1100);
    });
  return (
    <section class="grid gap-5">
      <ProjectHeader presenter={presenter} states={states} />
      <TakeDialog presenter={states} onShutter={shutter} />
      {/* The picture being taken: an iris closes over the page and opens again, then is gone. */}
      <Show when={iris()}>
        <div class="iris" aria-hidden="true" />
      </Show>
      {/* The first step for a new project, kept where a new user starts (#63, Q1). */}
      <Show
        when={
          presenter.overview.value().adapters.filter((adapter) => adapter.kind === "database")
            .length === 0
        }
      >
        <EmptyState
          icon="database"
          title="No databases yet"
          action={
            hasRole("qa") ? (
              <Button
                variant="primary"
                onClick={() =>
                  navigate(`/databases?project=${encodeURIComponent(props.slug)}&new=1`)
                }
              >
                Add a database
              </Button>
            ) : undefined
          }
        >
          Connect the databases behind the system under test, then take a state of them.
        </EmptyState>
      </Show>
      <Tabs
        items={PROJECT_TABS}
        value={presenter.tab()}
        onChange={(tab) => presenter.setTab(tab)}
        label="Project sections"
      />
      <Switch>
        <Match when={presenter.tab() === "states"}>
          <StatesView
            slug={props.slug}
            presenter={states}
            headStateId={presenter.overview.value().project.head.state_id}
            headUnknown={presenter.overview.value().project.head.status === "unknown"}
            headDirty={presenter.overview.value().project.head.dirty}
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

export default function ProjectView(props: { slug: string }): JSX.Element {
  const presenter = createProjectPresenter(() => props.slug);
  // The built-in Inspect project only reads, so it has no states, HEAD or settings to show (#56).
  return (
    <Loading fallback={<Pending>Loading project...</Pending>}>
      <Show
        when={presenter.overview.value().project.kind === "inspect"}
        fallback={<RegularProject presenter={presenter} slug={props.slug} />}
      >
        <InspectProject presenter={presenter} slug={props.slug} />
      </Show>
    </Loading>
  );
}

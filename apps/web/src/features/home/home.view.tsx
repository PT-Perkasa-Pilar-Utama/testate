import type { JSX } from "@solidjs/web";
import { Errored, For, Loading, Show } from "solid-js";
import type { AuditRow, Job, Project } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import Banner from "@/components/banner.tsx";
import EmptyState from "@/components/empty-state.tsx";
import { buttonClass } from "@/components/button.tsx";
import { formatWhen } from "@/lib/format.ts";
import { JOB_KIND_LABEL } from "@/lib/labels.ts";
import { href } from "@/lib/router.ts";
import { actor, hasRole } from "@/lib/session.ts";
import { formatBytes } from "../states/states.format.ts";
import { headBadge } from "../projects/projects.format.ts";
import { attention, greeting, projectOf, uptime } from "./home.format.ts";
import { createHomePresenter } from "./home.presenter.ts";
import type { HomePresenter } from "./home.presenter.ts";

function Card(props: {
  title: string;
  action?: { label: string; href: string };
  children: JSX.Element;
}): JSX.Element {
  return (
    <section class="grid content-start gap-3 rounded-lg p-4 ring ring-line">
      <div class="flex items-center justify-between gap-2">
        <h3 class="text-base font-semibold text-heading">{props.title}</h3>
        <Show when={props.action}>
          {(action) => (
            <a class="text-sm text-muted hover:underline" href={href(action().href)}>
              {action().label}
            </a>
          )}
        </Show>
      </div>
      {props.children}
    </section>
  );
}

function Stat(props: { label: string; value: string }): JSX.Element {
  return (
    <div class="grid gap-0.5 rounded-lg px-4 py-3 ring ring-line">
      <span class="text-xl font-semibold tabular-nums text-heading">{props.value}</span>
      <span class="text-sm text-muted">{props.label}</span>
    </div>
  );
}

/** The line every role wants first: which state each project's databases are on. */
function ProjectRow(props: { project: Project }): JSX.Element {
  const badge = (): ReturnType<typeof headBadge> => headBadge(props.project.head);
  return (
    <a
      class="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-hover"
      href={href(`/projects/${props.project.slug}`)}
    >
      <span class="truncate font-medium text-body">{props.project.name}</span>
      <Badge variant={badge().tone}>{badge().label}</Badge>
    </a>
  );
}

function JobRow(props: { job: Job; projects: readonly Project[] }): JSX.Element {
  const where = (): string => projectOf(props.projects, props.job);
  return (
    <div class="flex items-center justify-between gap-3 px-2 py-1.5 text-sm">
      <span class="truncate text-body">
        {JOB_KIND_LABEL[props.job.kind]}
        <Show when={where() !== ""}> · {where()}</Show>
      </span>
      <span class="shrink-0 whitespace-nowrap tabular-nums text-muted">
        {formatWhen(props.job.started_at ?? props.job.created_at)}
      </span>
    </div>
  );
}

function ActivityRow(props: { row: AuditRow }): JSX.Element {
  return (
    <div class="flex items-center justify-between gap-3 px-2 py-1.5 text-sm">
      <span class="flex min-w-0 items-center gap-2">
        <span class="truncate text-body">{props.row.actor.label}</span>
        {/* The raw action, as the audit screen shows it: these are the words the log itself uses
            and a second vocabulary here would be one more thing to learn. */}
        <code class="truncate text-xs text-muted">{props.row.action}</code>
      </span>
      <span class="shrink-0 whitespace-nowrap tabular-nums text-muted">
        {formatWhen(props.row.created_at)}
      </span>
    </div>
  );
}

/** Numbers first, so the shape of the day is one glance. Each role gets the ones it can act on. */
function Stats(props: { presenter: HomePresenter }): JSX.Element {
  return (
    <div class="grid gap-3 grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]">
      <Stat label="Projects" value={String(props.presenter.projects.value().length)} />
      <Stat label="Running now" value={String(props.presenter.running.value().total)} />
      <Stat label="Failed in a day" value={String(props.presenter.failed.value().total)} />
      <Show when={props.presenter.checkouts}>
        {(checkouts) => <Stat label="Checkouts in a day" value={String(checkouts().value())} />}
      </Show>
      <Show when={props.presenter.people}>
        {(people) => (
          <>
            <Stat label="Users" value={String(people().value().users)} />
            <Stat label="Tokens" value={String(people().value().tokens)} />
          </>
        )}
      </Show>
      <Show when={props.presenter.health}>
        {(health) => (
          <Stat
            label="Free on the data disk"
            value={formatBytes(health().value().checks.data_dir.free_bytes)}
          />
        )}
      </Show>
    </div>
  );
}

/** Only what is wrong. A card that says "all green" is a card people learn to skip. */
function Attention(props: { presenter: HomePresenter }): JSX.Element {
  const found = (): ReturnType<typeof attention> =>
    attention(props.presenter.failed.value().total, props.presenter.health?.value() ?? null);
  return (
    <Card title="Needs attention" action={{ label: "All jobs", href: "/jobs" }}>
      <Show
        when={found().length > 0}
        fallback={<p class="px-2 text-sm text-muted">Nothing is asking for you.</p>}
      >
        <div class="grid gap-1.5">
          <For each={found()}>
            {(item) => (
              <Banner variant={item.tone === "error" ? "error" : "alert"}>{item.label}</Banner>
            )}
          </For>
        </div>
      </Show>
    </Card>
  );
}

/** The instance itself, for the person who is responsible for it. */
function Instance(props: { presenter: HomePresenter }): JSX.Element {
  return (
    <Show when={props.presenter.health}>
      {(health) => (
        <Card title="This instance" action={{ label: "Settings", href: "/settings" }}>
          <dl class="grid gap-1.5 text-sm">
            <For
              each={[
                ["Version", health().value().version],
                ["Up for", uptime(health().value().uptime_s)],
                ["Snapshot store", health().value().checks.snapshot_store.driver],
                ["Queued jobs", String(health().value().checks.dispatcher.queued)],
                ["Sealed key", health().value().checks.sealed_keys.active_fingerprint],
              ]}
            >
              {(pair) => (
                <div class="flex items-center justify-between gap-3 px-2">
                  <dt class="text-muted">{pair[0]}</dt>
                  <dd class="truncate font-mono text-xs text-body">{pair[1]}</dd>
                </div>
              )}
            </For>
          </dl>
        </Card>
      )}
    </Show>
  );
}

/**
 * Where everyone lands.
 *
 * It was two lines of marketing copy. Each role now gets what it can act on: a Guest reads state,
 * a Tester sees its own work moving, an Administrator sees the instance. Nothing here is fetched
 * for a role that would be refused it, which is decided when the presenter is built rather than
 * when a card renders (docs/PROJECT_REWORK.md).
 */
export default function HomeView(): JSX.Element {
  const presenter = createHomePresenter(() => new Date());
  const who = (): string => actor()?.label ?? "";
  return (
    <section class="grid gap-6">
      <div class="grid gap-1">
        <h2 class="text-xl font-semibold text-heading">
          {greeting(new Date())}
          <Show when={who() !== ""}>, {who()}</Show>
        </h2>
        <p class="text-muted">Git for your test database. Reset the database, not the developer.</p>
      </div>
      <Errored fallback={(error) => <Banner variant="error">{String(error())}</Banner>}>
        <Loading fallback={<p class="text-muted">Reading the instance...</p>}>
          <Stats presenter={presenter} />
          <div class="grid items-start gap-4 lg:grid-cols-2">
            <Card title="Projects" action={{ label: "All projects", href: "/projects" }}>
              <Show
                when={presenter.projects.value().length > 0}
                fallback={
                  <EmptyState icon="folder" title="No projects yet">
                    <Show
                      when={hasRole("qa")}
                      fallback={<>Someone with the Tester role creates the first one.</>}
                    >
                      <a class={buttonClass("primary", "sm")} href={href("/projects")}>
                        Create the first one
                      </a>
                    </Show>
                  </EmptyState>
                }
              >
                <div class="grid">
                  <For each={presenter.projects.value().slice(0, 6)}>
                    {(project) => <ProjectRow project={project} />}
                  </For>
                </div>
              </Show>
            </Card>
            <Card title="Running now" action={{ label: "All jobs", href: "/jobs" }}>
              <Show
                when={presenter.running.value().rows.length > 0}
                fallback={<p class="px-2 text-sm text-muted">Nothing is running.</p>}
              >
                <div class="grid">
                  <For each={presenter.running.value().rows.slice(0, 6)}>
                    {(job) => <JobRow job={job} projects={presenter.projects.value()} />}
                  </For>
                </div>
              </Show>
            </Card>
            <Attention presenter={presenter} />
            <Show when={presenter.activity}>
              {(activity) => (
                <Card title="Recent activity" action={{ label: "Audit log", href: "/audit" }}>
                  <Show
                    when={activity().value().length > 0}
                    fallback={<p class="px-2 text-sm text-muted">Nothing has happened yet.</p>}
                  >
                    <div class="grid">
                      <For each={activity().value().slice(0, 6)}>
                        {(row) => <ActivityRow row={row} />}
                      </For>
                    </div>
                  </Show>
                </Card>
              )}
            </Show>
            <Instance presenter={presenter} />
          </div>
        </Loading>
      </Errored>
    </section>
  );
}

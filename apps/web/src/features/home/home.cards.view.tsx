import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import type { AuditRow, Job, Project } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import { LineGrid, Stat } from "@/components/line-grid.tsx";
import { formatWhen } from "@/lib/format.ts";
import { JOB_KIND_LABEL } from "@/lib/labels.ts";
import { href } from "@/lib/router.ts";
import { formatBytes } from "../states/states.format.ts";
import { headBadge } from "../projects/projects.format.ts";
import { projectOf } from "./home.format.ts";
import type { HomePresenter } from "./home.presenter.ts";

/**
 * One card of the home screen: a heading, the way to the rest of it, and a body that fills the
 * card. `flex-1` on the body is what keeps a short card level with the tall one beside it, and
 * why an empty card centres its one line instead of leaving a hollow under it.
 */
export function Card(props: {
  title: string;
  action?: { label: string; href: string };
  class?: string;
  children: JSX.Element;
}): JSX.Element {
  return (
    <section class={["flex flex-col rounded-lg bg-surface ring ring-line", props.class]}>
      <div class="flex items-center justify-between gap-3 border-b border-hairline px-5 py-3.5">
        <h3 class="text-base font-semibold tracking-tight text-heading">{props.title}</h3>
        <Show when={props.action}>
          {(action) => (
            <a
              class="font-mono text-[11px] tracking-[0.12em] text-muted uppercase hover:text-accent"
              href={href(action().href)}
            >
              {action().label}
            </a>
          )}
        </Show>
      </div>
      <div class="flex flex-1 flex-col px-3 py-2">{props.children}</div>
    </section>
  );
}

/** What an empty card says, centred in the room the card has. */
export function Quiet(props: { children: JSX.Element }): JSX.Element {
  return <p class="my-auto px-2 py-6 text-center text-sm text-muted">{props.children}</p>;
}

/** The line every role wants first: which state each project's databases are on. */
export function ProjectRow(props: { project: Project }): JSX.Element {
  const badge = (): ReturnType<typeof headBadge> => headBadge(props.project.head);
  return (
    <a
      class="flex items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-hover"
      href={href(`/projects/${props.project.slug}`)}
    >
      <span class="grid min-w-0">
        <span class="truncate font-medium text-body">{props.project.name}</span>
        <span class="truncate font-mono text-xs text-muted">{props.project.slug}</span>
      </span>
      <Badge variant={badge().tone}>{badge().label}</Badge>
    </a>
  );
}

export function JobRow(props: { job: Job; projects: readonly Project[] }): JSX.Element {
  const where = (): string => projectOf(props.projects, props.job);
  return (
    <div class="flex items-center justify-between gap-3 px-2 py-2 text-sm">
      <span class="truncate text-body">
        {JOB_KIND_LABEL[props.job.kind]}
        <Show when={where() !== ""}>
          <span class="text-muted"> · {where()}</span>
        </Show>
      </span>
      <span class="shrink-0 font-mono text-xs whitespace-nowrap text-muted">
        {formatWhen(props.job.started_at ?? props.job.created_at)}
      </span>
    </div>
  );
}

export function ActivityRow(props: { row: AuditRow }): JSX.Element {
  return (
    <div class="flex items-center justify-between gap-3 px-2 py-2 text-sm">
      <span class="flex min-w-0 items-center gap-2">
        <span class="truncate text-body">{props.row.actor.label}</span>
        {/* The raw action, as the audit screen shows it: these are the words the log itself uses
            and a second vocabulary here would be one more thing to learn. */}
        <code class="truncate text-xs text-muted">{props.row.action}</code>
      </span>
      <span class="shrink-0 font-mono text-xs whitespace-nowrap text-muted">
        {formatWhen(props.row.created_at)}
      </span>
    </div>
  );
}

/**
 * Numbers first, so the shape of the day is one glance. Each role gets the ones it can act on,
 * and the grid has exactly as many columns as that role has numbers: an `auto-fit` grid left the
 * sixth stat alone on a second row with five empty cells beside it.
 */
export function Stats(props: { presenter: HomePresenter }): JSX.Element {
  const columns = (): string => {
    if (props.presenter.people !== null) return "grid-cols-3 lg:grid-cols-6";
    if (props.presenter.checkouts !== null) return "grid-cols-2 lg:grid-cols-4";
    return "grid-cols-3";
  };
  return (
    <LineGrid class={columns()}>
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
    </LineGrid>
  );
}

import type { JSX } from "@solidjs/web";
import { Errored, For, Loading, Show } from "solid-js";

import Banner from "@/components/banner.tsx";
import EmptyState from "@/components/empty-state.tsx";
import { buttonClass } from "@/components/button.tsx";
import { Eyebrow } from "@/components/page-header.tsx";
import { href } from "@/lib/router.ts";
import { actor, hasRole } from "@/lib/session.ts";
import { ActivityRow, Card, JobRow, ProjectRow, Quiet, Stats } from "./home.cards.view.tsx";
import { attention, greeting, uptime } from "./home.format.ts";
import { createHomePresenter } from "./home.presenter.ts";
import type { HomePresenter } from "./home.presenter.ts";

/** Only what is wrong. A card that says "all green" is a card people learn to skip. */
function Attention(props: { presenter: HomePresenter }): JSX.Element {
  const found = (): ReturnType<typeof attention> =>
    attention(props.presenter.failed.value().total, props.presenter.health?.value() ?? null);
  return (
    <Card title="Needs attention" action={{ label: "All jobs", href: "/jobs" }}>
      <Show when={found().length > 0} fallback={<Quiet>Nothing is asking for you.</Quiet>}>
        <div class="grid gap-1.5 py-1">
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
          <dl class="grid content-start gap-0.5 py-1 text-sm">
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
                <div class="flex items-center justify-between gap-3 px-2 py-1">
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
 * when a card renders.
 */
export default function HomeView(): JSX.Element {
  const presenter = createHomePresenter(() => new Date());
  const who = (): string => actor()?.label ?? "";
  return (
    <section class="grid gap-6">
      <div class="grid gap-1.5">
        <Eyebrow>Home</Eyebrow>
        <h2 class="text-2xl font-semibold tracking-tight text-heading">
          {greeting(new Date())}
          <Show when={who() !== ""}>, {who()}</Show>
        </h2>
        <p class="text-muted">Git for your test database. Reset the database, not the developer.</p>
      </div>
      <Errored fallback={(error) => <Banner variant="error">{String(error())}</Banner>}>
        <Loading fallback={<p class="text-muted">Reading the instance...</p>}>
          <Stats presenter={presenter} />
          {/* Two rows of three: the wide card is the one with the list, the narrow column beside
              it stacks the two that are usually one line. Rows stretch, so nothing sits over a
              hollow. */}
          <div class="grid gap-4 lg:grid-cols-3">
            <Card
              title="Projects"
              action={{ label: "All projects", href: "/projects" }}
              class="lg:col-span-2"
            >
              <Show
                when={presenter.projects.value().length > 0}
                fallback={
                  <div class="my-auto py-2">
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
                  </div>
                }
              >
                <div class="grid">
                  <For each={presenter.projects.value().slice(0, 8)}>
                    {(project) => <ProjectRow project={project} />}
                  </For>
                </div>
              </Show>
            </Card>
            <div class="grid gap-4">
              <Card title="Running now" action={{ label: "All jobs", href: "/jobs" }}>
                <Show
                  when={presenter.running.value().rows.length > 0}
                  fallback={<Quiet>Nothing is running.</Quiet>}
                >
                  <div class="grid">
                    <For each={presenter.running.value().rows.slice(0, 6)}>
                      {(job) => <JobRow job={job} projects={presenter.projects.value()} />}
                    </For>
                  </div>
                </Show>
              </Card>
              <Attention presenter={presenter} />
            </div>
            <Show when={presenter.activity}>
              {(activity) => (
                <Card
                  title="Recent activity"
                  action={{ label: "Audit log", href: "/audit" }}
                  class="lg:col-span-2"
                >
                  <Show
                    when={activity().value().length > 0}
                    fallback={<Quiet>Nothing has happened yet.</Quiet>}
                  >
                    <div class="grid">
                      <For each={activity().value().slice(0, 8)}>
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

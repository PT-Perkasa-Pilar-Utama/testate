import type { JSX } from "@solidjs/web";
import { Loading, Match, Show, Switch } from "solid-js";

import Badge from "@/components/badge.tsx";
import Button from "@/components/button.tsx";
import LayerCard from "@/components/layer-card.tsx";
import Meter from "@/components/meter.tsx";
import Tabs from "@/components/tabs.tsx";
import { hasRole } from "@/lib/session.ts";
import AdaptersView from "../adapters/adapters.view.tsx";
import CheckoutsView from "../checkouts/checkouts.view.tsx";
import DiffsView from "../diffs/diffs.view.tsx";
import HooksView from "../hooks/hooks.view.tsx";
import ImportsView from "../imports/imports.view.tsx";
import StatesView from "../states/states.view.tsx";
import { DeleteDialog, EditDialog } from "./project-settings.view.tsx";
import { PROJECT_TABS, createProjectPresenter } from "./project.presenter.ts";

export default function ProjectView(props: { slug: string }): JSX.Element {
  const presenter = createProjectPresenter(() => props.slug);
  return (
    <section class="grid gap-6">
      <Loading fallback={<p class="text-kumo-subtle">Loading project...</p>}>
        <div class="flex items-start justify-between gap-4">
          <div class="grid gap-1.5">
            <h2 class="text-lg font-semibold">{presenter.project.value().name}</h2>
            <p class="text-kumo-subtle">
              {presenter.project.value().description ?? "No description."}
            </p>
          </div>
          <div class="flex items-center gap-2">
            <Badge
              variant={presenter.project.value().head.status === "at_state" ? "success" : "warning"}
            >
              HEAD:{" "}
              {presenter.project.value().head.state_name ?? presenter.project.value().head.status}
            </Badge>
            <Show when={hasRole("qa")}>
              <Button size="sm" variant="secondary" onClick={() => presenter.openEdit()}>
                Edit
              </Button>
            </Show>
            <Show when={hasRole("admin")}>
              <Button size="sm" variant="destructive" onClick={() => void presenter.openDelete()}>
                Delete
              </Button>
            </Show>
          </div>
        </div>
        <LayerCard class="grid gap-2 px-5 py-4">
          <Meter
            value={presenter.usedPercent()}
            max={100}
            label="Snapshot quota"
            detail={`${presenter.usedPercent()}% used`}
          />
        </LayerCard>
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
          <StatesView slug={props.slug} onChanged={() => presenter.project.refresh()} />
        </Match>
        <Match when={presenter.tab() === "checkouts"}>
          <CheckoutsView slug={props.slug} onChanged={() => presenter.project.refresh()} />
        </Match>
        <Match when={presenter.tab() === "diffs"}>
          <DiffsView slug={props.slug} />
        </Match>
        <Match when={presenter.tab() === "imports"}>
          <ImportsView slug={props.slug} />
        </Match>
        <Match when={presenter.tab() === "hooks"}>
          <HooksView slug={props.slug} />
        </Match>
      </Switch>
      <EditDialog presenter={presenter} />
      <DeleteDialog presenter={presenter} slug={props.slug} />
    </section>
  );
}

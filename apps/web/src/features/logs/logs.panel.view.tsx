import type { JSX } from "@solidjs/web";
import { Loading, Match, Show, Switch } from "solid-js";
import type { Adapter } from "@testate/shared";

import Button from "@/components/button.tsx";
import EmptyState from "@/components/empty-state.tsx";
import Pending from "@/components/pending.tsx";
import { createRefreshable } from "@/lib/async.ts";
import { hasRole } from "@/lib/session.ts";
import { createLogfileFormPresenter } from "./logs.form.ts";
import { LogfileDialog } from "./logs.form.view.tsx";
import { createDockerFormPresenter } from "./logs.docker.ts";
import { DockerDialog } from "./logs.docker.view.tsx";
import { createIngestPresenter } from "./logs.ingest.ts";
import { createLokiFormPresenter } from "./logs.loki.ts";
import { LokiDialog } from "./logs.loki.view.tsx";
import { createJournaldFormPresenter } from "./logs.journald.ts";
import { JournaldDialog } from "./logs.journald.view.tsx";
import { IngestConfirms, IngestDialog, IngestReveal } from "./logs.ingest.view.tsx";
import { logsModel } from "./logs.model.ts";
import { LogViewerPanel } from "./logs.viewer.view.tsx";

type PanelProps = {
  slug: string;
  adapter: Adapter;
  /** In Inspect only the adapter's creator or an admin may edit it (#56). */
  manages: boolean;
  onSaved: () => void;
};

/** The edit button a tester or admin who manages the adapter sees. */
function EditButton(props: PanelProps & { onEdit: () => void }): JSX.Element {
  return (
    <Show when={hasRole("qa") && props.manages}>
      <div>
        <Button size="sm" variant="secondary" onClick={() => props.onEdit()}>
          Edit log adapter
        </Button>
      </div>
    </Show>
  );
}

/** Built only for a logfile adapter, so an ingest page never asks for host suggestions. */
function LogfileControls(props: PanelProps): JSX.Element {
  const edit = createLogfileFormPresenter(
    () => props.slug,
    () => props.onSaved()
  );
  return (
    <>
      <EditButton {...props} onEdit={() => edit.openEdit(props.adapter)} />
      <LogfileDialog presenter={edit} />
    </>
  );
}

/** A journald adapter's: edit its login and its sources (#86). */
function JournaldControls(props: PanelProps): JSX.Element {
  const edit = createJournaldFormPresenter(
    () => props.slug,
    () => props.onSaved()
  );
  return (
    <>
      <EditButton {...props} onEdit={() => edit.openEdit(props.adapter)} />
      <JournaldDialog presenter={edit} />
    </>
  );
}

/** A docker adapter's: edit its connection and its containers (#88). */
function DockerControls(props: PanelProps): JSX.Element {
  const edit = createDockerFormPresenter(
    () => props.slug,
    () => props.onSaved()
  );
  return (
    <>
      <EditButton {...props} onEdit={() => edit.openEdit(props.adapter)} />
      <DockerDialog presenter={edit} />
    </>
  );
}

/** A loki adapter's: edit its login and its queries (#90). */
function LokiControls(props: PanelProps): JSX.Element {
  const edit = createLokiFormPresenter(
    () => props.slug,
    () => props.onSaved()
  );
  return (
    <>
      <EditButton {...props} onEdit={() => edit.openEdit(props.adapter)} />
      <LokiDialog presenter={edit} />
    </>
  );
}

/** An ingest adapter's own controls (I3a, I8): edit, a new token, and clearing for an admin. */
function IngestControls(props: PanelProps): JSX.Element {
  const ingest = createIngestPresenter(
    () => props.slug,
    () => props.onSaved()
  );
  return (
    <>
      <Show when={hasRole("qa") && props.manages}>
        <div class="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => ingest.openEdit(props.adapter)}>
            Edit log adapter
          </Button>
          <Button size="sm" variant="secondary" onClick={() => ingest.askRotate(props.adapter)}>
            Rotate token
          </Button>
          <Show when={hasRole("admin")}>
            <Button size="sm" variant="danger" onClick={() => ingest.askClear(props.adapter)}>
              Clear logs
            </Button>
          </Show>
        </div>
      </Show>
      <IngestDialog presenter={ingest} />
      <IngestReveal presenter={ingest} />
      <IngestConfirms presenter={ingest} />
    </>
  );
}

/**
 * A log adapter's page body: its controls and its sources, read. The source names come from the
 * API for every engine: a configured adapter's names, an ingest adapter's services (I2).
 */
export function LogsPanel(props: PanelProps): JSX.Element {
  const sources = createRefreshable(() => logsModel.sources(props.slug, props.adapter.id));
  const saved = (): void => {
    sources.refresh();
    props.onSaved();
  };
  return (
    <div class="grid gap-4">
      <Switch fallback={<LogfileControls {...props} onSaved={saved} />}>
        <Match when={props.adapter.engine === "ingest"}>
          <IngestControls {...props} onSaved={saved} />
        </Match>
        <Match when={props.adapter.engine === "journald"}>
          <JournaldControls {...props} onSaved={saved} />
        </Match>
        <Match when={props.adapter.engine === "docker"}>
          <DockerControls {...props} onSaved={saved} />
        </Match>
        <Match when={props.adapter.engine === "loki"}>
          <LokiControls {...props} onSaved={saved} />
        </Match>
      </Switch>
      <Loading fallback={<Pending>Listing sources...</Pending>}>
        <Show
          when={sources.value().length > 0}
          fallback={
            <EmptyState icon="file-text" title="Nothing pushed yet">
              Lines your app sends to {logsModel.pushUrl(props.adapter.id)} appear here, one source
              per service.
            </EmptyState>
          }
        >
          <LogViewerPanel
            slug={props.slug}
            adapterId={props.adapter.id}
            sources={sources.value()}
          />
        </Show>
      </Loading>
    </div>
  );
}

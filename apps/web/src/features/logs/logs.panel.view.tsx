import type { JSX } from "@solidjs/web";
import { Loading, Show } from "solid-js";
import type { Adapter } from "@testate/shared";

import Button from "@/components/button.tsx";
import EmptyState from "@/components/empty-state.tsx";
import Pending from "@/components/pending.tsx";
import { createRefreshable } from "@/lib/async.ts";
import { hasRole } from "@/lib/session.ts";
import { createLogfileFormPresenter } from "./logs.form.ts";
import { LogfileDialog } from "./logs.form.view.tsx";
import { createIngestPresenter } from "./logs.ingest.ts";
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

/** Built only for a logfile adapter, so an ingest page never asks for host suggestions. */
function LogfileControls(props: PanelProps): JSX.Element {
  const edit = createLogfileFormPresenter(
    () => props.slug,
    () => props.onSaved()
  );
  return (
    <>
      <Show when={hasRole("qa") && props.manages}>
        <div>
          <Button size="sm" variant="secondary" onClick={() => edit.openEdit(props.adapter)}>
            Edit log adapter
          </Button>
        </div>
      </Show>
      <LogfileDialog presenter={edit} />
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
 * API for both engines: a logfile's configured names, an ingest adapter's services (I2).
 */
export function LogsPanel(props: PanelProps): JSX.Element {
  const sources = createRefreshable(() => logsModel.sources(props.slug, props.adapter.id));
  const saved = (): void => {
    sources.refresh();
    props.onSaved();
  };
  return (
    <div class="grid gap-4">
      <Show
        when={props.adapter.engine === "ingest"}
        fallback={<LogfileControls {...props} onSaved={saved} />}
      >
        <IngestControls {...props} onSaved={saved} />
      </Show>
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

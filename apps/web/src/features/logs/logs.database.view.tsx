import type { JSX } from "@solidjs/web";
import { For, Loading, Show } from "solid-js";
import type { Adapter } from "@testate/shared";

import EmptyState from "@/components/empty-state.tsx";
import Pending from "@/components/pending.tsx";
import { createRefreshable } from "@/lib/async.ts";
import { missingSources } from "./logs.database.ts";
import { logsModel } from "./logs.model.ts";
import { LogViewerPanel } from "./logs.viewer.view.tsx";

/**
 * A database adapter's "Server logs" (#84, D5): the sources its credential can read, in the same
 * viewer as every log, and for each it cannot, the grant that opens it (D3). Never a dead tab.
 */
export function ServerLogsPanel(props: { slug: string; adapter: Adapter }): JSX.Element {
  const sources = createRefreshable(() => logsModel.sources(props.slug, props.adapter.id));
  return (
    <Loading fallback={<Pending>Listing sources...</Pending>}>
      <div class="grid gap-4">
        <Show
          when={sources.value().length > 0}
          fallback={
            <EmptyState icon="file-text" title="No server log this user can read">
              Run one of the grants below, then Retest connection.
            </EmptyState>
          }
        >
          <LogViewerPanel
            slug={props.slug}
            adapterId={props.adapter.id}
            sources={sources.value()}
          />
        </Show>
        <Show when={missingSources(props.adapter, sources.value()).length > 0}>
          <div class="grid gap-2 rounded-lg px-4 py-3 ring ring-hairline">
            <p class="text-sm text-muted">Also available with more access:</p>
            <For each={missingSources(props.adapter, sources.value())}>
              {(missing) => (
                <div class="grid gap-1 text-sm">
                  <span class="font-medium text-body">{missing.label}</span>
                  <code class="font-mono text-[0.9em] break-all text-muted select-text">
                    {missing.grant}
                  </code>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Loading>
  );
}

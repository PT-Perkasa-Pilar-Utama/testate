import type { JSX } from "@solidjs/web";
import { For, Loading } from "solid-js";

import Badge from "@/components/badge.tsx";
import Button from "@/components/button.tsx";
import Icon from "@/components/icon.tsx";
import LayerCard from "@/components/layer-card.tsx";
import { formatUptime } from "./settings.format.ts";
import type { SettingsPresenter } from "./settings.presenter.ts";

const CHECK_LABELS = [
  ["metadata_db", "Metadata database"],
  ["data_dir", "Data directory"],
  ["snapshot_store", "Snapshot store"],
  ["dispatcher", "Job dispatcher"],
  ["log_sink", "Log sink"],
  ["sealed_keys", "Sealed keys"],
] as const;

const DOT = { ok: "bg-success", degraded: "bg-warning", down: "bg-danger" } as const;
const STATUS_BADGE = { ok: "success", degraded: "warning", down: "error" } as const;

/**
 * The health report, where an admin already is. It used to be its own screen at `/health` that
 * nothing in the app linked to, so you had to know the URL. A load balancer wants the API endpoint,
 * not a page, and that endpoint is unchanged.
 *
 * The overall status and the quiet metadata line answer "is the instance fine" before the per-check
 * list answers "which part isn't", the way `states.timeline.view.tsx` reads HEAD before the row.
 */
export default function HealthCard(props: { presenter: SettingsPresenter }): JSX.Element {
  return (
    <LayerCard class="grid gap-3 px-5 py-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <Icon name="activity" class="h-4 w-4 text-muted" />
          <h3 class="text-base font-semibold text-heading">Instance health</h3>
        </div>
        <Button size="sm" variant="secondary" onClick={() => props.presenter.health.refresh()}>
          Refresh
        </Button>
      </div>
      <Loading fallback={<p class="text-muted">Checking...</p>}>
        <div class="grid gap-1">
          <div class="flex flex-wrap items-center gap-2">
            <Badge variant={STATUS_BADGE[props.presenter.health.value().status]}>
              {props.presenter.health.value().status}
            </Badge>
          </div>
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <span>{props.presenter.health.value().env}</span>
            <span aria-hidden="true">·</span>
            <span>v{props.presenter.health.value().version}</span>
            <span aria-hidden="true">·</span>
            <span>up {formatUptime(props.presenter.health.value().uptime_s)}</span>
          </div>
        </div>
        <dl class="grid gap-2 border-t border-hairline pt-3">
          <For each={CHECK_LABELS}>
            {([key, label]) => (
              <div class="flex items-center justify-between gap-3 text-base">
                <dt>{label}</dt>
                <dd class="flex items-center gap-2 text-muted">
                  <span
                    class={[
                      "h-2 w-2 shrink-0 rounded-full",
                      DOT[props.presenter.health.value().checks[key].status],
                    ]}
                    aria-hidden="true"
                  />
                  <span>{props.presenter.health.value().checks[key].status}</span>
                </dd>
              </div>
            )}
          </For>
        </dl>
      </Loading>
    </LayerCard>
  );
}

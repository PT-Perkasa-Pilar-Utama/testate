import type { JSX } from "@solidjs/web";
import { For, Loading, Show } from "solid-js";

import Badge from "@/components/badge.tsx";
import Button from "@/components/button.tsx";
import Icon from "@/components/icon.tsx";
import LayerCard from "@/components/layer-card.tsx";
import type { HealthAdmin } from "@testate/shared";
import { formatBytes } from "../states/states.format.ts";
import { formatUptime } from "./settings.format.ts";
import type { SettingsPresenter } from "./settings.presenter.ts";

type Checks = HealthAdmin["checks"];

/** `1` -> "1 older key", `2` -> "2 older keys". The ring keeps them so values sealed earlier open. */
function olderKeys(count: number): string {
  if (count === 0) return "";
  return ` \u00b7 ${count} older ${count === 1 ? "key" : "keys"} still open data`;
}

/**
 * What each check is, in the words of someone who runs the instance rather than someone who wrote
 * it. "Log sink" and "Sealed keys" said nothing to an infrastructure team, and a row that only ever
 * said "ok" said nothing to anyone: the numbers below all came back in the same response and were
 * thrown away. The one description that promises less than it seems: the key row reports which key
 * is active, and the API does not verify that it opens anything.
 */
const CHECKS: {
  key: keyof Checks;
  label: string;
  description: string;
  detail: (checks: Checks) => string;
}[] = [
  {
    key: "metadata_db",
    label: "Metadata database",
    description: "Projects, states, users and the audit trail.",
    detail: (checks) => `${checks.metadata_db.latency_ms} ms`,
  },
  {
    key: "data_dir",
    label: "Data directory",
    description: "The disk this instance writes to.",
    detail: (checks) => `${formatBytes(checks.data_dir.free_bytes)} free`,
  },
  {
    key: "snapshot_store",
    label: "Snapshot store",
    description: "Where the snapshot data itself is kept.",
    detail: (checks) =>
      `${checks.snapshot_store.driver} \u00b7 ${checks.snapshot_store.latency_ms} ms`,
  },
  {
    key: "dispatcher",
    label: "Job runner",
    description: "Runs snapshots, checkouts, imports and backups.",
    detail: (checks) =>
      `${checks.dispatcher.running} running \u00b7 ${checks.dispatcher.queued} queued`,
  },
  {
    key: "log_sink",
    label: "Log file",
    description: "The daily request and audit log on disk.",
    detail: () => "",
  },
  {
    key: "sealed_keys",
    label: "Credential encryption",
    description: "The key that encrypts saved database passwords.",
    detail: (checks) =>
      `key ${checks.sealed_keys.active_fingerprint}${olderKeys(checks.sealed_keys.extra_values)}`,
  },
];

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
          <h3 id="health" class="scroll-mt-6 text-base font-semibold text-heading">
            Instance health
          </h3>
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
        <dl class="grid gap-3 border-t border-hairline pt-3">
          <For each={CHECKS}>
            {(check) => (
              <div class="flex items-start justify-between gap-4">
                <dt class="grid gap-0.5">
                  <span class="text-base">{check.label}</span>
                  <span class="text-sm text-muted">{check.description}</span>
                </dt>
                <dd class="flex shrink-0 items-center gap-2 text-base text-muted">
                  <Show when={check.detail(props.presenter.health.value().checks) !== ""}>
                    <span class="tabular-nums">
                      {"\u00b7"} {check.detail(props.presenter.health.value().checks)}
                    </span>
                  </Show>
                  <span
                    class={[
                      "h-2 w-2 shrink-0 rounded-full",
                      DOT[props.presenter.health.value().checks[check.key].status],
                    ]}
                    aria-hidden="true"
                  />
                  <span>{props.presenter.health.value().checks[check.key].status}</span>
                </dd>
              </div>
            )}
          </For>
        </dl>
      </Loading>
    </LayerCard>
  );
}

import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import type { Adapter, AdapterMode } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import { statusReason } from "@/lib/api-error.ts";
import Banner from "@/components/banner.tsx";
import LayerCard from "@/components/layer-card.tsx";
import { formatWhen } from "@/lib/format.ts";
import { ADAPTER_MODE_LABEL } from "@/lib/labels.ts";
import { STATUS_VARIANT } from "../adapters/adapters.fields.ts";

function modeLabel(mode: AdapterMode): string {
  return ADAPTER_MODE_LABEL[mode];
}

/** What the adapter is, on one quiet line: engine, tier, mode, and when it was last checked. */
function Facts(props: { adapter: Adapter }): JSX.Element {
  const a = (): Adapter => props.adapter;
  return (
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
      <span>
        {a().engine}
        {a().engine_version === null ? "" : ` ${a().engine_version}`}
      </span>
      <span aria-hidden="true">·</span>
      <span>{a().tier} tier</span>
      <span aria-hidden="true">·</span>
      <span>{modeLabel(a().mode)}</span>
      <Show when={a().last_probe_at}>
        {(at) => (
          <>
            <span aria-hidden="true">·</span>
            <span class="tabular-nums">checked {formatWhen(at())}</span>
          </>
        )}
      </Show>
    </div>
  );
}

/**
 * Status in a real place instead of buried in a badge among six others. `ok` stays a quiet badge;
 * `error` and `disabled` also get a banner with the reason, because a disabled adapter with no
 * visible reason is the state that most confuses an operator (the rework of 2026-09-01).
 */
export function StatusLine(props: { adapter: Adapter }): JSX.Element {
  const a = (): Adapter => props.adapter;
  return (
    <div class="grid gap-2">
      <div class="flex flex-wrap items-center gap-2">
        <Badge variant={STATUS_VARIANT[a().status]}>{a().status}</Badge>
        <Facts adapter={a()} />
      </div>
      <Show when={a().status !== "ok"}>
        <Banner variant={a().status === "disabled" ? "alert" : "error"}>
          {statusReason(a().status_message) ??
            "No reason recorded. Retest the connection, or edit it to check the details."}
        </Banner>
      </Show>
    </div>
  );
}

/** A sealed value's fingerprint when set; a single reference to `sealed` so TypeScript can narrow
 * the `set` discriminant, which two separate `props.adapter.credential` reads would not. */
/** What is on record about a secret: never the secret, only which key of the instance sealed it. */
function Sealed(props: { sealed: Adapter["credential"] }): JSX.Element {
  const on = (): { key_fingerprint: string } | null => (props.sealed.set ? props.sealed : null);
  return (
    <Show when={on()} fallback={<span class="text-muted">none saved</span>}>
      {(stored) => (
        <span>
          sealed under key <code class="text-[0.9em]">{stored().key_fingerprint}</code>
        </span>
      )}
    </Show>
  );
}

/** The connection's identity, kept out of the way of the junction: what secret is stored and since
 * when, not what a person came to this screen to do. */
export function ConnectionCard(props: { adapter: Adapter }): JSX.Element {
  const credential = (): Adapter["credential"] => props.adapter.credential;
  const readonlyCredential = (): Adapter["readonly_credential"] =>
    props.adapter.readonly_credential;
  return (
    <LayerCard class="grid gap-2">
      <h3 class="text-xs font-medium text-muted">Connection</h3>
      <dl class="grid gap-1.5 text-sm">
        <div class="flex items-center justify-between gap-4">
          <dt class="text-muted">Password</dt>
          <dd>
            <Sealed sealed={credential()} />
          </dd>
        </div>
        <Show when={props.adapter.kind === "database"}>
          <div class="flex items-center justify-between gap-4">
            <dt class="text-muted">Read-only password</dt>
            <dd>
              <Sealed sealed={readonlyCredential()} />
            </dd>
          </div>
        </Show>
        <div class="flex items-center justify-between gap-4">
          <dt class="text-muted">Connected since</dt>
          <dd class="tabular-nums text-body">{formatWhen(props.adapter.created_at)}</dd>
        </div>
      </dl>
    </LayerCard>
  );
}

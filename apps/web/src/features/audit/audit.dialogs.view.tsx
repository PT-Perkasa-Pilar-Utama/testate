import type { JSX } from "@solidjs/web";
import type { AuditPayload, AuditRow, JsonValue } from "@testate/shared";
import { Errored, Loading, Match, Show, Switch } from "solid-js";
import * as v from "valibot";

import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import Dialog from "@/components/dialog.tsx";
import Icon from "@/components/icon.tsx";
import JsonView from "@/components/json-view.tsx";
import Pending from "@/components/pending.tsx";
import { humanMessage } from "@/lib/api-error.ts";
import { showToast } from "@/lib/toast.ts";
import type { AuditPresenter } from "./audit.presenter.ts";

/**
 * What one row touched. `target_id` is the row in the database and `target_label` is what a person
 * called it, and an audit trail needs both: the name to recognise it, the id to go and find it when
 * the name has since changed or the thing is gone.
 */
export function TargetDialog(props: { row: AuditRow | null; onClose: () => void }): JSX.Element {
  // Read once, on open: `reset` tears the dialog down rather than changing it, and holding the
  // accessor would read a null row on the way out.
  const row = (): AuditRow | null => props.row;
  return (
    <Dialog
      size="lg"
      open={row() !== null}
      onClose={() => props.onClose()}
      title="Target"
      description={`What ${row()?.action ?? "this"} acted on.`}
    >
      <dl class="grid gap-3 text-sm">
        <div class="grid gap-1">
          <dt class="text-xs text-muted">Kind</dt>
          <dd>{row()?.target_type}</dd>
        </div>
        <div class="grid gap-1">
          <dt class="text-xs text-muted">Name at the time</dt>
          <dd>
            <Show
              when={row()?.target_label}
              fallback={
                <span class="text-muted">
                  Not recorded. This row predates the column that keeps it.
                </span>
              }
            >
              {(label) => <span class="font-medium text-heading">{label()}</span>}
            </Show>
          </dd>
        </div>
        <div class="grid gap-1">
          <dt class="text-xs text-muted">Id</dt>
          <dd>
            <code class="text-xs break-all">{row()?.target_id}</code>
          </dd>
        </div>
      </dl>
    </Dialog>
  );
}

const KEPT_FOR = "Kept for the days set under Settings, then the row stays and the bodies go.";

/** One side: the body as coloured JSON, or the text that survived the cut, or why there is none. */
function Pane(props: {
  label: string;
  body: JsonValue | null;
  truncated: boolean;
  empty: string;
}): JSX.Element {
  // Boxed so a JSON `false` or `0` still counts as a body: `Match` narrows on truthiness.
  const boxed = (): { value: JsonValue } | null =>
    props.body === null ? null : { value: props.body };
  const copy = async (): Promise<void> => {
    const body = props.body;
    if (body === null) return;
    const text = v.is(v.string(), body) ? body : JSON.stringify(body, null, 2);
    await navigator.clipboard.writeText(text);
    showToast(`${props.label} copied`, "success");
  };
  return (
    <div class="grid min-w-0 content-start gap-2">
      <div class="flex items-center justify-between">
        <span class="font-mono text-xs tracking-wide text-muted uppercase">{props.label}</span>
        <Button
          size="xs"
          variant="ghost"
          disabled={props.body === null}
          onClick={() => void copy()}
        >
          <Icon name="copy" class="h-3.5 w-3.5" />
          Copy
        </Button>
      </div>
      <div class="max-h-[60vh] overflow-auto rounded-md p-3 ring ring-hairline">
        <Switch>
          <Match when={props.body === null}>
            <span class="text-sm text-muted">{props.empty}</span>
          </Match>
          <Match when={props.truncated && v.is(v.string(), props.body)}>
            <pre class="font-mono text-sm leading-6 whitespace-pre-wrap select-text">
              {String(props.body)}
            </pre>
          </Match>
          <Match when={boxed()}>{(json) => <JsonView value={json().value} />}</Match>
        </Switch>
      </div>
      <Show when={props.truncated}>
        <span class="text-xs text-muted">Cut at 64 KiB; the rest was not kept.</span>
      </Show>
    </div>
  );
}

function Bodies(props: { payload: AuditPayload }): JSX.Element {
  return (
    <Switch>
      <Match when={props.payload.state === "none"}>
        <p class="text-sm text-muted">No request behind this row: a job or the system wrote it.</p>
      </Match>
      <Match when={props.payload.state === "expired"}>
        <p class="text-sm text-muted">The bodies behind this row have expired. {KEPT_FOR}</p>
      </Match>
      <Match when={props.payload.state === "kept"}>
        <div class="grid gap-4 sm:grid-cols-2">
          <Pane
            label="Request"
            body={props.payload.request}
            truncated={props.payload.request_truncated}
            empty="No request body."
          />
          <Pane
            label="Response"
            body={props.payload.response}
            truncated={props.payload.response_truncated}
            empty="No response body."
          />
        </div>
      </Match>
    </Switch>
  );
}

/**
 * What was sent and what came back, side by side. Secrets were replaced and identifiers
 * shortened before anything was stored, so what shows here is what the API kept, not less.
 */
export function PayloadDialog(props: { presenter: AuditPresenter }): JSX.Element {
  const row = (): AuditRow | null => props.presenter.inspecting();
  const line = (): string => {
    const found = props.presenter.payload.value();
    if (found === null || found.method === null) return `Behind ${row()?.action ?? "this row"}.`;
    return `${found.method} ${found.path} answered ${found.status}.`;
  };
  return (
    <Dialog
      size="wide"
      open={row() !== null}
      onClose={() => props.presenter.closeInspect()}
      title="Request and response"
      description={line()}
    >
      <Errored
        fallback={(error) => (
          <Banner variant="error">
            {humanMessage(error(), "The request and response could not be read")}
          </Banner>
        )}
      >
        <Loading fallback={<Pending>Reading the bodies...</Pending>}>
          <Show when={props.presenter.payload.value()}>
            {(payload) => <Bodies payload={payload()} />}
          </Show>
        </Loading>
      </Errored>
    </Dialog>
  );
}

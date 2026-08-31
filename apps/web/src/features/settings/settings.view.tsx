import type { JSX } from "@solidjs/web";
import PageHeader from "@/components/page-header.tsx";
import { For, Loading, Show } from "solid-js";

import Badge from "@/components/badge.tsx";
import Button from "@/components/button.tsx";
import Input from "@/components/input.tsx";
import InputArea from "@/components/input-area.tsx";
import LayerCard from "@/components/layer-card.tsx";
import Switch from "@/components/switch.tsx";
import { Cell, Head, Row, Table } from "@/components/table.tsx";
import { SECTIONS, createSettingsPresenter } from "./settings.presenter.ts";
import type { SettingsPresenter } from "./settings.presenter.ts";
import { MigrateDialog } from "./settings.store.view.tsx";

/** One editable section; keys set by the environment stay read-only (story 120). */
function Section(props: {
  presenter: SettingsPresenter;
  name: (typeof SECTIONS)[number];
}): JSX.Element {
  const onSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    void props.presenter.save(props.name);
  };
  return (
    <LayerCard class="grid gap-3 px-5 py-4">
      <form class="grid gap-3" onSubmit={onSubmit}>
        <div class="flex items-center justify-between">
          <h3 class="font-medium capitalize">{props.name}</h3>
          <Button type="submit" size="sm" variant="primary">
            Save {props.name}
          </Button>
        </div>
        <Table>
          <thead>
            <tr>
              <Head>Key</Head>
              <Head>Value</Head>
              <Head>Source</Head>
            </tr>
          </thead>
          <tbody>
            <For each={props.presenter.rows(props.name)}>
              {(row) => (
                <Row>
                  <Cell>
                    <code>{row.key}</code>
                  </Cell>
                  <Cell>
                    <Input
                      size="sm"
                      type="number"
                      min="0"
                      aria-label={row.key}
                      disabled={row.locked}
                      value={props.presenter.drafts().get(row.key) ?? row.value}
                      onInput={(event) =>
                        props.presenter.setValue(row.key, event.currentTarget.value)
                      }
                    />
                  </Cell>
                  <Cell>
                    <Badge variant={row.locked ? "warning" : "outline"}>
                      {row.locked ? "environment" : "editable"}
                    </Badge>
                  </Cell>
                </Row>
              )}
            </For>
          </tbody>
        </Table>
      </form>
    </LayerCard>
  );
}

/** Backup of the metadata (and optionally every blob) as a job with a download link (story 121). */
const CHECK_LABELS = [
  ["metadata_db", "Metadata database"],
  ["data_dir", "Data directory"],
  ["snapshot_store", "Snapshot store"],
  ["dispatcher", "Job dispatcher"],
  ["log_sink", "Log sink"],
  ["sealed_keys", "Sealed keys"],
] as const;

const DOT = { ok: "bg-success", degraded: "bg-warning", down: "bg-danger" } as const;

/**
 * The health report, where an admin already is. It used to be its own screen at `/health` that
 * nothing in the app linked to, so you had to know the URL. A load balancer wants the API endpoint,
 * not a page, and that endpoint is unchanged.
 */
function HealthCard(props: { presenter: SettingsPresenter }): JSX.Element {
  return (
    <LayerCard class="grid gap-3 px-5 py-4">
      <div class="flex items-center justify-between gap-3">
        <h3 class="text-base font-semibold text-heading">Instance health</h3>
        <Button size="sm" variant="secondary" onClick={() => props.presenter.health.refresh()}>
          Refresh
        </Button>
      </div>
      <Loading fallback={<p class="text-muted">Checking...</p>}>
        <dl class="grid gap-2">
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

function BackupCard(props: { presenter: SettingsPresenter }): JSX.Element {
  return (
    <LayerCard class="grid gap-3 px-5 py-4">
      <h3 class="font-medium">Backup</h3>
      <div class="flex flex-wrap items-center gap-4">
        <Switch
          label="Include snapshot blobs"
          checked={props.presenter.includeBlobs()}
          onChange={(value) => props.presenter.setIncludeBlobs(value)}
        />
        <Button variant="secondary" onClick={() => void props.presenter.runBackup()}>
          Run backup
        </Button>
        <Show when={props.presenter.backupJob()}>
          {(job) => (
            <span class="inline-flex items-center gap-2 text-sm">
              <Badge variant={job().status === "succeeded" ? "success" : "info"}>
                {job().status}
              </Badge>
              <Show when={job().status === "succeeded"}>
                <a class="underline" href={props.presenter.backupUrl(job())}>
                  Download backup
                </a>
              </Show>
            </span>
          )}
        </Show>
      </div>
    </LayerCard>
  );
}

/**
 * The deny list decides which hosts an adapter may reach, and it had no screen at all: the only
 * way to see it was the API, and the only way to change it was a PATCH by hand.
 */
function NetguardCard(props: { presenter: SettingsPresenter }): JSX.Element {
  const text = (): string =>
    props.presenter.denyDraft() ?? props.presenter.value().netguard.deny.join("\n");
  const onSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    void props.presenter.saveDeny();
  };
  return (
    <LayerCard class="grid gap-3 px-5 py-4">
      <div class="grid gap-1">
        <h3 class="font-medium">Blocked hosts</h3>
        <p class="text-sm text-muted">
          One host, CIDR or host:port per line. An adapter pointing at a blocked address is disabled
          when you save.
        </p>
      </div>
      <form class="grid gap-3" onSubmit={onSubmit}>
        <InputArea
          rows="4"
          aria-label="Blocked hosts"
          value={text()}
          onInput={(event) => props.presenter.setDenyDraft(event.currentTarget.value)}
        />
        <div class="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" type="submit">
            Save blocked hosts
          </Button>
          <span class="text-sm text-muted">
            Always blocked: {props.presenter.value().netguard.fixed.join(", ")}
          </span>
        </div>
      </form>
    </LayerCard>
  );
}

export default function SettingsView(): JSX.Element {
  const presenter = createSettingsPresenter();
  return (
    <section class="grid gap-6">
      <PageHeader
        title="Settings"
        description="Instance defaults. Values set by the environment cannot be edited here."
      />
      <Loading fallback={<p class="text-muted">Loading settings...</p>}>
        <LayerCard class="flex flex-wrap items-center gap-3 px-5 py-4">
          <span class="text-sm">Snapshot store</span>
          <Badge variant="outline">{presenter.value().store.driver}</Badge>
          <Badge variant={presenter.value().store.locked_by_env ? "warning" : "secondary"}>
            {presenter.value().store.locked_by_env ? "set by environment" : "editable"}
          </Badge>
          <Show when={!presenter.value().store.locked_by_env}>
            <Button size="sm" variant="secondary" onClick={() => presenter.openMigrate()}>
              Migrate store
            </Button>
          </Show>
        </LayerCard>
        <HealthCard presenter={presenter} />
        <For each={SECTIONS}>{(name) => <Section presenter={presenter} name={name} />}</For>
        <NetguardCard presenter={presenter} />
        <BackupCard presenter={presenter} />
      </Loading>
      <MigrateDialog presenter={presenter} />
    </section>
  );
}

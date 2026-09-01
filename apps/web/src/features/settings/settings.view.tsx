import type { JSX } from "@solidjs/web";
import PageHeader from "@/components/page-header.tsx";
import { For, Loading, Show } from "solid-js";
import type { Settings } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import Button from "@/components/button.tsx";
import Icon from "@/components/icon.tsx";
import Input from "@/components/input.tsx";
import InputArea from "@/components/input-area.tsx";
import LayerCard from "@/components/layer-card.tsx";
import Switch from "@/components/switch.tsx";
import { Cell, Head, Row, Table } from "@/components/table.tsx";
import HealthCard from "./settings.health.view.tsx";
import { SECTIONS, createSettingsPresenter } from "./settings.presenter.ts";
import type { SettingRow, SettingsPresenter } from "./settings.presenter.ts";
import { MigrateDialog } from "./settings.store.view.tsx";

/** What a person calls each key, never `retention.stash_keep`; the unit rides along in the label. */
const LABELS = {
  "retention.stash_keep": "Stashes to keep",
  "retention.diff_days": "Diff history (days)",
  "retention.query_history_days": "Query history (days)",
  "retention.job_history_days": "Job history (days)",
  "retention.audit_days": "Audit log (days)",
  "retention.import_run_days": "Import run history (days)",
  "quota.default_bytes": "Default project quota (bytes)",
  "quota.instance_ceiling_bytes": "Instance quota ceiling (bytes)",
  "limits.query_rows_default": "Default query row limit",
  "limits.query_rows_max": "Maximum query rows",
  "limits.query_bytes": "Query result size (bytes)",
  "limits.query_timeout_ms": "Query timeout (ms)",
  "limits.query_timeout_max_ms": "Maximum query timeout (ms)",
  "limits.upload_mb": "Upload size limit (MB)",
  "limits.token_requests_per_minute": "Token requests per minute",
  "limits.agent_requests_per_minute": "Agent requests per minute",
  "limits.failed_logins_per_minute": "Failed logins per minute, per address",
  "limits.write_session_idle_minutes": "Write session idle timeout (minutes)",
  "limits.job_concurrency": "Concurrent jobs",
} as const;

/** `row.key` is built at runtime as `${section}.${name}`, so it is a plain string, not one of
 *  LABELS's literal keys — the membership check below is what makes the lookup safe. */
function labelFor(row: SettingRow): string {
  if (!(row.key in LABELS)) return row.name;
  // SAFETY: the `in` check above proved `row.key` names one of LABELS's own properties.
  return LABELS[row.key as keyof typeof LABELS];
}

/** A labelled cluster of cards, so the stack reads as sections instead of one long scroll. */
function Group(props: {
  title: string;
  description?: string;
  id?: string;
  children: JSX.Element;
}): JSX.Element {
  return (
    <div class="grid gap-4 border-t border-line pt-6 first:border-t-0 first:pt-0">
      <div class="grid gap-1.5">
        <h3 id={props.id} class="scroll-mt-6 text-base font-semibold text-heading">
          {props.title}
        </h3>
        <Show when={props.description}>
          <p class="text-sm text-muted">{props.description}</p>
        </Show>
      </div>
      <div class="grid gap-4">{props.children}</div>
    </div>
  );
}

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
          <h3 id={props.name} class="scroll-mt-6 text-base font-semibold text-heading capitalize">
            {props.name}
          </h3>
          <Button type="submit" size="sm" variant="primary">
            Save {props.name}
          </Button>
        </div>
        <Table>
          <thead>
            <tr>
              <Head>Setting</Head>
              <Head>Value</Head>
              <Head>Source</Head>
            </tr>
          </thead>
          <tbody>
            <For each={props.presenter.rows(props.name)}>
              {(row) => (
                <Row>
                  <Cell>
                    <div class="grid gap-0.5">
                      <span>{labelFor(row)}</span>
                      <code class="text-xs text-muted">{row.key}</code>
                    </div>
                  </Cell>
                  <Cell>
                    <Input
                      size="sm"
                      type="number"
                      min="0"
                      aria-label={labelFor(row)}
                      disabled={row.locked}
                      value={props.presenter.drafts().get(row.key) ?? row.value}
                      onInput={(event) =>
                        props.presenter.setValue(row.key, event.currentTarget.value)
                      }
                    />
                  </Cell>
                  <Cell>
                    <Show
                      when={row.locked}
                      fallback={<span class="text-xs text-muted">editable</span>}
                    >
                      <Badge variant="outline">
                        <Icon name="lock" class="h-3 w-3" />
                        environment
                      </Badge>
                    </Show>
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

/** Snapshot driver at a glance; locked when the environment pins it, so Migrate has nothing to do. */
function StoreCard(props: { presenter: SettingsPresenter }): JSX.Element {
  const store = (): Settings["store"] => props.presenter.value().store;
  return (
    <LayerCard class="flex flex-wrap items-center gap-3 px-5 py-4">
      <span class="text-base">Snapshot store</span>
      <Badge variant="outline">{store().driver}</Badge>
      <Show
        when={store().locked_by_env}
        fallback={
          <Button size="sm" variant="secondary" onClick={() => props.presenter.openMigrate()}>
            Migrate store
          </Button>
        }
      >
        <Badge variant="outline">
          <Icon name="lock" class="h-3 w-3" />
          set by environment
        </Badge>
      </Show>
    </LayerCard>
  );
}

/** Backup of the metadata (and optionally every blob) as a job with a download link (story 121). */
function BackupCard(props: { presenter: SettingsPresenter }): JSX.Element {
  return (
    <LayerCard class="grid gap-3 px-5 py-4">
      <h3 class="text-base font-semibold text-heading">Backup</h3>
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
        <h3 id="blocked-hosts" class="scroll-mt-6 text-base font-semibold text-heading">
          Blocked hosts
        </h3>
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
        <HealthCard presenter={presenter} />
        <Group
          id="storage"
          title="Storage"
          description="Where snapshots live, and how to get a copy out."
        >
          <StoreCard presenter={presenter} />
          <BackupCard presenter={presenter} />
        </Group>
        <Group
          title="Instance defaults"
          description="Limits and retention every new project inherits."
        >
          <For each={SECTIONS}>{(name) => <Section presenter={presenter} name={name} />}</For>
        </Group>
        <NetguardCard presenter={presenter} />
      </Loading>
      <MigrateDialog presenter={presenter} />
    </section>
  );
}

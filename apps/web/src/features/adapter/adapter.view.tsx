import type { JSX } from "@solidjs/web";
import { For, Loading, Match, Show, Switch } from "solid-js";
import type { Adapter, Entry, Introspection, RestRequest } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import Dialog from "@/components/dialog.tsx";
import { Cell, Head, Row, Table } from "@/components/table.tsx";
import { href, navigate } from "@/lib/router.ts";
import { hasRole } from "@/lib/session.ts";
import { createAdapterPresenter } from "./adapter.presenter.ts";
import type { AdapterPresenter } from "./adapter.presenter.ts";

function TablesView(props: { schema: Introspection; base: string }): JSX.Element {
  const tablePath = (name: string): string => `${props.base}/tables/${encodeURIComponent(name)}`;
  const open = (event: MouseEvent, name: string): void => {
    event.preventDefault();
    navigate(tablePath(name));
  };
  return (
    <Table>
      <thead>
        <tr>
          <Head>Table</Head>
          <Head>Rows (est.)</Head>
          <Head>Columns</Head>
          <Head>Primary key</Head>
        </tr>
      </thead>
      <tbody>
        <For each={props.schema.tables}>
          {(table) => (
            <Row>
              <Cell>
                <a
                  class="hover:underline"
                  href={href(tablePath(qualified(table)))}
                  onClick={(event) => open(event, qualified(table))}
                >
                  <code>{qualified(table)}</code>
                </a>
              </Cell>
              <Cell>{table.row_estimate}</Cell>
              <Cell>{table.columns.length}</Cell>
              <Cell>{table.primary_key?.join(", ") ?? "none"}</Cell>
            </Row>
          )}
        </For>
      </tbody>
    </Table>
  );
}

function FilesView(props: { entries: Entry[] }): JSX.Element {
  return (
    <Table>
      <thead>
        <tr>
          <Head>Name</Head>
          <Head>Kind</Head>
          <Head>Size</Head>
          <Head>Modified</Head>
        </tr>
      </thead>
      <tbody>
        <For each={props.entries}>
          {(entry) => (
            <Row>
              <Cell>{entry.name}</Cell>
              <Cell>{entry.kind}</Cell>
              <Cell>{entry.size_bytes ?? ""}</Cell>
              <Cell>{entry.modified_at ?? ""}</Cell>
            </Row>
          )}
        </For>
      </tbody>
    </Table>
  );
}

function RequestsView(props: { requests: RestRequest[] }): JSX.Element {
  return (
    <Table>
      <thead>
        <tr>
          <Head>Name</Head>
          <Head>Method</Head>
          <Head>Path</Head>
          <Head>Expected</Head>
        </tr>
      </thead>
      <tbody>
        <For each={props.requests}>
          {(request) => (
            <Row>
              <Cell>{request.name}</Cell>
              <Cell>
                <Badge variant="outline">{request.method}</Badge>
              </Cell>
              <Cell>
                <code>{request.path}</code>
              </Cell>
              <Cell>{request.expected_status ?? "any"}</Cell>
            </Row>
          )}
        </For>
      </tbody>
    </Table>
  );
}

const STATUS_VARIANT = { ok: "success", error: "error", disabled: "secondary" } as const;

function qualified(table: { schema: string | null; name: string }): string {
  return table.schema === null ? table.name : `${table.schema}.${table.name}`;
}

function Actions(props: { presenter: AdapterPresenter; base: string }): JSX.Element {
  const adapter = (): Adapter => props.presenter.adapter.value();
  const fingerprint = (): string => {
    const credential = adapter().credential;
    return credential.set ? credential.key_fingerprint : "";
  };
  return (
    <div class="flex flex-wrap items-center gap-2">
      <Badge variant={STATUS_VARIANT[adapter().status]}>
        {adapter().status_message === null
          ? adapter().status
          : `${adapter().status}: ${adapter().status_message}`}
      </Badge>
      <Show when={adapter().credential.set}>
        <Badge variant="outline">sealed · {fingerprint()}</Badge>
      </Show>
      <Show when={adapter().kind === "database"}>
        <Button size="sm" variant="secondary" onClick={() => navigate(`${props.base}/query`)}>
          Query console
        </Button>
      </Show>
      <Show when={hasRole("qa")}>
        <Button size="sm" variant="secondary" onClick={() => void props.presenter.retest()}>
          Retest
        </Button>
      </Show>
      <Show when={hasRole("qa") && adapter().kind === "database" && adapter().mode === "sandbox"}>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void props.presenter.setMode("read_only")}
        >
          Make read-only
        </Button>
      </Show>
      <Show
        when={hasRole("admin") && adapter().kind === "database" && adapter().mode === "read_only"}
      >
        <Button size="sm" variant="outline" onClick={() => void props.presenter.setMode("sandbox")}>
          Allow restores
        </Button>
      </Show>
      <Show when={hasRole("qa")}>
        <Button size="sm" variant="destructive" onClick={() => void props.presenter.openDelete()}>
          Delete
        </Button>
      </Show>
    </div>
  );
}

function DeleteDialog(props: { presenter: AdapterPresenter; name: string }): JSX.Element {
  const onSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    void props.presenter.confirmDelete();
  };
  return (
    <Show when={props.presenter.plan()}>
      {(plan) => (
        <Dialog
          open
          onClose={() => props.presenter.closeDelete()}
          title={`Delete ${props.name}`}
          description="A database adapter returns to its init state first; the adapter row goes only after that succeeds or is skipped."
        >
          <form class="grid gap-4" onSubmit={onSubmit}>
            <Banner variant="alert">
              Plan: {plan().adapter.action}
              {plan().adapter.reason === undefined ? "" : ` (${plan().adapter.reason})`} ·{" "}
              {plan().states_referencing} state(s) reference this adapter · expires{" "}
              {plan().expires_at}
            </Banner>
            <div class="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => props.presenter.closeDelete()}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive">
                {plan().adapter.action === "skip"
                  ? "Delete without restore"
                  : "Return to init and delete"}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </Show>
  );
}

export default function AdapterView(props: { slug: string; id: string }): JSX.Element {
  const presenter = createAdapterPresenter(
    () => props.slug,
    () => props.id
  );
  const base = (): string => `/projects/${props.slug}/adapters/${props.id}`;
  return (
    <section class="grid gap-6">
      <Loading fallback={<p class="text-kumo-subtle">Loading adapter...</p>}>
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="grid gap-1.5">
            <h2 class="text-lg font-semibold">{presenter.adapter.value().name}</h2>
            <p class="text-kumo-subtle">
              {presenter.adapter.value().engine}
              {presenter.adapter.value().engine_version === null
                ? ""
                : ` ${presenter.adapter.value().engine_version}`}{" "}
              · {presenter.adapter.value().tier} tier · {presenter.adapter.value().mode}
            </p>
          </div>
          <Actions presenter={presenter} base={base()} />
        </div>
        <Switch>
          <Match when={presenter.tables()}>
            {(schema) => <TablesView schema={schema()} base={base()} />}
          </Match>
          <Match when={presenter.entries()}>{(entries) => <FilesView entries={entries()} />}</Match>
          <Match when={presenter.requests()}>
            {(requests) => <RequestsView requests={requests()} />}
          </Match>
        </Switch>
        <DeleteDialog presenter={presenter} name={presenter.adapter.value().name} />
      </Loading>
    </section>
  );
}

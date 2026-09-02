import type { JSX } from "@solidjs/web";
import PageHeader from "@/components/page-header.tsx";
import { formatWhen } from "@/lib/format.ts";
import { Loading, Match, Show, Switch, createSignal } from "solid-js";
import type { Adapter } from "@testate/shared";

import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import Dialog from "@/components/dialog.tsx";
import { hasRole } from "@/lib/session.ts";
import { ConnectionCard, StatusLine } from "./adapter.summary.view.tsx";
import Tabs from "@/components/tabs.tsx";

const TABLE_VIEWS = [
  { id: "list", label: "List" },
  { id: "diagram", label: "Diagram" },
] as const;
type TableView = (typeof TABLE_VIEWS)[number]["id"];

import Erd from "../erd/erd.view.tsx";
import { FilesView, JunctionToolbar, TablesView } from "./adapter.junction.view.tsx";
import EditDialog from "./adapter.edit.view.tsx";
import { createAdapterPresenter } from "./adapter.presenter.ts";
import type { AdapterPresenter } from "./adapter.presenter.ts";

/**
 * Everything that changes the adapter rather than reads it, grouped so it reads as one decision
 * apart from the junction below: renaming and retesting stay ordinary buttons, and Delete stays
 * last and marked, the way `states.view.tsx`'s row menu keeps it.
 */
function AdminActions(props: { presenter: AdapterPresenter; adapter: Adapter }): JSX.Element {
  const a = (): Adapter => props.adapter;
  return (
    <Show when={hasRole("qa")}>
      <div class="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => props.presenter.openEdit()}>
          Edit adapter
        </Button>
        <Button size="sm" variant="secondary" onClick={() => void props.presenter.retest()}>
          Retest
        </Button>
        <Show when={a().kind === "database" && a().mode === "sandbox"}>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void props.presenter.setMode("read_only")}
          >
            Make read-only
          </Button>
        </Show>
        <Show when={hasRole("admin") && a().kind === "database" && a().mode === "read_only"}>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void props.presenter.setMode("sandbox")}
          >
            Allow restores
          </Button>
        </Show>
        <Button size="sm" variant="danger" onClick={() => void props.presenter.openDelete()}>
          Delete
        </Button>
      </div>
    </Show>
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
              {formatWhen(plan().expires_at)}
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
  const [tableView, setTableView] = createSignal<TableView>("list");
  return (
    <section class="grid gap-6">
      <Loading fallback={<p class="text-muted">Loading adapter...</p>}>
        <PageHeader
          title={presenter.adapter.value().name}
          actions={<AdminActions presenter={presenter} adapter={presenter.adapter.value()} />}
        />
        <StatusLine adapter={presenter.adapter.value()} />
        <div class="grid gap-3">
          <JunctionToolbar adapter={presenter.adapter.value()} base={base()} />
          <Switch>
            <Match when={presenter.tables()}>
              {(schema) => (
                <div class="grid gap-3">
                  {/* The same shape States uses for List and Tree: one set of data, two ways to
                      read it (docs/PROJECT_REWORK.md). */}
                  <Tabs
                    items={TABLE_VIEWS}
                    value={tableView()}
                    onChange={(next) => setTableView(next)}
                    label="How to show the tables"
                    variant="segmented"
                  />
                  <Show when={tableView() === "list"}>
                    <TablesView schema={schema()} base={base()} />
                  </Show>
                  <Show when={tableView() === "diagram"}>
                    <Erd tables={schema().tables} />
                  </Show>
                </div>
              )}
            </Match>
            <Match when={presenter.entries()}>
              {(entries) => <FilesView entries={entries()} />}
            </Match>
          </Switch>
        </div>
        <ConnectionCard adapter={presenter.adapter.value()} />
        <DeleteDialog presenter={presenter} name={presenter.adapter.value().name} />
        <EditDialog presenter={presenter} adapter={presenter.adapter.value()} />
      </Loading>
    </section>
  );
}

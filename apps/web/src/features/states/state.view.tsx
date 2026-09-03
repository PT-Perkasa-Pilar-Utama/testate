import type { JSX } from "@solidjs/web";
import { Errored, For, Loading, Show, onSettled } from "solid-js";
import type { StateDetail } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import Banner from "@/components/banner.tsx";
import Breadcrumbs from "@/components/breadcrumbs.tsx";
import Button, { buttonClass } from "@/components/button.tsx";
import Icon from "@/components/icon.tsx";
import PageHeader from "@/components/page-header.tsx";
import Pending from "@/components/pending.tsx";
import { formatWhen } from "@/lib/format.ts";
import { STATE_KIND_LABEL } from "@/lib/labels.ts";
import { href, navigate } from "@/lib/router.ts";
import { hasRole } from "@/lib/session.ts";
import { createPreflightPresenter } from "../checkouts/preflight.presenter.ts";
import PreflightDialog from "../checkouts/preflight.view.tsx";
import { createStatePresenter } from "./state.presenter.ts";
import type { StatePresenter } from "./state.presenter.ts";
import { DatabaseRail, TablesPane } from "./state.tables.view.tsx";
import CompareDialog from "./states.compare.view.tsx";
import { DeleteDialog, EditDialog } from "./states.dialogs.view.tsx";
import { formatBytes, statePath } from "./states.format.ts";
import { statesModel } from "./states.model.ts";
import { checkoutBlockedReason, createStatesPresenter } from "./states.presenter.ts";
import type { StatesPresenter } from "./states.presenter.ts";

/** Where the databases stand against this state, in one badge; nothing when this is not HEAD. */
function HeadBadge(props: { presenter: StatePresenter }): JSX.Element {
  const head = (): { status: string; dirty: boolean } => props.presenter.head.value();
  return (
    <Show when={props.presenter.isHead()}>
      <Show
        when={head().status !== "unknown"}
        fallback={<Badge variant="warning">HEAD, restore failed part way</Badge>}
      >
        <Show
          when={!head().dirty}
          fallback={<Badge variant="warning">HEAD, the databases moved since</Badge>}
        >
          <Badge variant="success">HEAD, the databases are on this state</Badge>
        </Show>
      </Show>
    </Show>
  );
}

/** Who, when, how many, how big, from where: what the state is before what it holds. */
function Facts(props: { presenter: StatePresenter; slug: string }): JSX.Element {
  const d = (): StateDetail => props.presenter.detail.value();
  return (
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
      <HeadBadge presenter={props.presenter} />
      <Show when={d().protected}>
        <Badge variant="outline">
          <Icon name="lock" class="h-3 w-3" />
          protected
        </Badge>
      </Show>
      <span>{d().actor.label}</span>
      <span aria-hidden="true">·</span>
      <span class="tabular-nums">{formatWhen(d().created_at)}</span>
      <span aria-hidden="true">·</span>
      <span>
        {d().adapters.length} {d().adapters.length === 1 ? "database" : "databases"}
      </span>
      <span aria-hidden="true">·</span>
      <span class="tabular-nums">{formatBytes(d().size_bytes)}</span>
      <Loading fallback={null}>
        <Show when={props.presenter.parent.value()}>
          {(parent) => (
            <>
              <span aria-hidden="true">·</span>
              <span>
                parent{" "}
                <a
                  class="text-link hover:underline"
                  href={href(statePath(props.slug, parent().id))}
                >
                  {parent().name}
                </a>
              </span>
            </>
          )}
        </Show>
      </Loading>
      <For each={d().tags}>{(tag) => <Badge variant="info">{tag}</Badge>}</For>
    </div>
  );
}

/** Everything you do with a state, on the page; a stash is read and restored, never edited. */
function Actions(props: {
  presenter: StatePresenter;
  states: StatesPresenter;
  checkout: (state: StateDetail) => Promise<void>;
  slug: string;
}): JSX.Element {
  const d = (): StateDetail => props.presenter.detail.value();
  const editable = (): boolean => hasRole("qa") && d().kind !== "stash";
  const compareLive = async (): Promise<void> => {
    const staticSlug = props.slug;
    if (await props.states.compareWith(d().id, null))
      navigate(`/projects/${encodeURIComponent(staticSlug)}?tab=activity&show=diffs`);
  };
  const toggleProtected = async (): Promise<void> => {
    await props.states.setProtected(d(), !d().protected);
    props.presenter.refresh();
  };
  return (
    <div class="flex flex-wrap items-center gap-2">
      <Show when={hasRole("qa")}>
        <Button
          size="sm"
          variant={props.presenter.isHead() ? "outline" : "accent"}
          disabled={d().status !== "ready"}
          title={checkoutBlockedReason(d())}
          onClick={() => void props.checkout(d())}
        >
          Check out
        </Button>
        <Button size="sm" variant="secondary" onClick={() => void compareLive()}>
          Compare with live
        </Button>
        <Button size="sm" variant="secondary" onClick={() => props.states.openCompare()}>
          Compare with...
        </Button>
      </Show>
      <a class={buttonClass("secondary", "sm")} href={props.states.archiveUrl(d())}>
        <Icon name="download" class="h-3.5 w-3.5" />
        Download
      </a>
      <Show when={editable()}>
        <Button size="sm" variant="secondary" onClick={() => props.states.openEdit(d())}>
          Edit
        </Button>
        <Button size="sm" variant="secondary" onClick={() => void toggleProtected()}>
          {d().protected ? "Unprotect" : "Protect"}
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={d().protected}
          onClick={() => props.states.openDelete(d())}
        >
          Delete
        </Button>
      </Show>
    </div>
  );
}

/**
 * One state, on a page of its own. It was a dialog of folds, one per database, which a hundred
 * tables outgrow: a rail picks the database, the pane searches its tables, and the address keeps
 * both so a link lands on a table.
 */
export default function StateView(props: { slug: string; id: string }): JSX.Element {
  const presenter = createStatePresenter(
    () => props.slug,
    () => props.id
  );
  const projectPath = (): string => `/projects/${encodeURIComponent(props.slug)}`;
  // A change to the state refreshes the page; a deleted state sends the reader back to the list.
  const refreshOrLeave = async (): Promise<void> => {
    const staticSlug = props.slug;
    const staticId = props.id;
    try {
      await statesModel.get(staticSlug, staticId);
      presenter.refresh();
    } catch {
      navigate(`/projects/${encodeURIComponent(staticSlug)}?tab=states`);
    }
  };
  const states = createStatesPresenter(
    () => props.slug,
    () => void refreshOrLeave()
  );
  const preflight = createPreflightPresenter(
    () => props.slug,
    () => presenter.refresh()
  );
  let search: HTMLInputElement | undefined;
  onSettled(() => {
    const onKey = (event: KeyboardEvent): void => {
      const typing =
        event.target instanceof HTMLElement && event.target.closest("input, textarea, select");
      if (event.key === "/" && typing === null) {
        event.preventDefault();
        search?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
  return (
    <section class="grid gap-4">
      <Errored
        fallback={(error) => (
          <div class="grid gap-3">
            <Banner variant="error">{String(error())}</Banner>
            <a class="text-link hover:underline" href={href(`${projectPath()}?tab=states`)}>
              Back to the states
            </a>
          </div>
        )}
      >
        <Loading fallback={<Pending>Loading the state...</Pending>}>
          <Breadcrumbs
            items={[
              { label: "Projects", href: "/projects" },
              { label: props.slug, href: projectPath() },
              { label: "states", href: `${projectPath()}?tab=states` },
              { label: presenter.detail.value().name },
            ]}
          />
          <PageHeader
            eyebrow={STATE_KIND_LABEL[presenter.detail.value().kind]}
            title={presenter.detail.value().name}
            description={presenter.detail.value().notes ?? "No notes."}
            actions={
              <Actions
                presenter={presenter}
                states={states}
                slug={props.slug}
                checkout={(state) => preflight.open(state)}
              />
            }
          />
          <Facts presenter={presenter} slug={props.slug} />
          <div class="grid gap-4 lg:grid-cols-[16rem_1fr]">
            <DatabaseRail presenter={presenter} />
            <Show
              when={presenter.picked()}
              fallback={<p class="text-sm text-muted">Nothing to show.</p>}
            >
              {(adapter) => (
                <TablesPane
                  presenter={presenter}
                  adapter={adapter()}
                  searchRef={(element) => {
                    search = element;
                  }}
                />
              )}
            </Show>
          </div>
        </Loading>
      </Errored>
      <EditDialog presenter={states} />
      <DeleteDialog presenter={states} />
      <CompareDialog
        presenter={states}
        base={props.id}
        onDone={() => navigate(`${projectPath()}?tab=activity&show=diffs`)}
      />
      <PreflightDialog presenter={preflight} />
    </section>
  );
}

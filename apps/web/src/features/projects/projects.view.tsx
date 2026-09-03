import type { JSX } from "@solidjs/web";
import PageHeader from "@/components/page-header.tsx";
import Pending from "@/components/pending.tsx";
import { formatWhen } from "@/lib/format.ts";
import { For, Loading, Show, createSignal } from "solid-js";

import Badge from "@/components/badge.tsx";
import Button from "@/components/button.tsx";
import EmptyState from "@/components/empty-state.tsx";
import { FilterField, FilterPanel, FilterToggle } from "@/components/filters.tsx";
import Icon from "@/components/icon.tsx";
import Input from "@/components/input.tsx";
import LoadMore from "@/components/load-more.tsx";
import {
  Cell,
  EmptyRow,
  Head,
  Row,
  SortColumn,
  Table,
  TableFooter,
  TableSearch,
  Truncated,
} from "@/components/table.tsx";
import { activeFilterCount } from "@/lib/table.ts";
import { href, navigate } from "@/lib/router.ts";
import { hasRole } from "@/lib/session.ts";
import { headBadge } from "./projects.format.ts";
import { CreateDialog } from "./projects.dialogs.view.tsx";
import { createProjectsPresenter } from "./projects.presenter.ts";
import type { ProjectsPresenter } from "./projects.presenter.ts";

/** The "New project" control, shared by the header and the empty state so there is one to keep in sync. */
function NewProjectButton(props: { presenter: ProjectsPresenter }): JSX.Element {
  return (
    <Show when={hasRole("qa")}>
      <Button variant="primary" onClick={() => props.presenter.openCreate()}>
        New project
      </Button>
    </Show>
  );
}

/** Search text or a date bound narrows the list; an empty result under either reads as "no
 *  matches", not as "no projects", so the big empty state gives way to the table's own row. */
function isFiltered(presenter: ProjectsPresenter): boolean {
  return (
    presenter.table.query() !== "" ||
    presenter.table.createdFrom() !== "" ||
    presenter.table.createdTo() !== ""
  );
}

export default function ProjectsView(): JSX.Element {
  const presenter = createProjectsPresenter();
  const [filtersOpen, setFiltersOpen] = createSignal(false);
  const activeCount = (): number =>
    activeFilterCount(presenter.table.createdFrom() !== "" || presenter.table.createdTo() !== "");
  return (
    <section class="grid gap-6">
      <PageHeader
        eyebrow="Workspace"
        title="Projects"
        description="Each project owns its adapters and states."
        actions={
          <>
            <TableSearch
              placeholder="Search projects..."
              value={presenter.table.query()}
              onInput={(value) => presenter.table.setQuery(value)}
            />
            <FilterToggle
              open={filtersOpen()}
              active={activeCount()}
              onToggle={() => setFiltersOpen((open) => !open)}
            />
            <NewProjectButton presenter={presenter} />
          </>
        }
      />
      <FilterPanel open={filtersOpen()}>
        <FilterField label="Created from">
          <Input
            type="date"
            value={presenter.table.createdFrom()}
            onInput={(event) => presenter.table.setCreatedFrom(event.currentTarget.value)}
          />
        </FilterField>
        <FilterField label="Created to">
          <Input
            type="date"
            value={presenter.table.createdTo()}
            onInput={(event) => presenter.table.setCreatedTo(event.currentTarget.value)}
          />
        </FilterField>
      </FilterPanel>
      <Loading fallback={<Pending>Loading projects...</Pending>}>
        <Show
          when={presenter.table.rows().length > 0 || isFiltered(presenter)}
          fallback={
            <EmptyState
              icon="folder"
              title="No projects yet"
              action={<NewProjectButton presenter={presenter} />}
            >
              A project groups the databases of one system under test, and every state anyone takes
              across them.
              <Show when={hasRole("qa")}> Create one to start taking states.</Show>
            </EmptyState>
          }
        >
          <Table>
            <thead>
              <tr>
                <SortColumn view={presenter.table} column="name">
                  Project
                </SortColumn>
                <Head>HEAD</Head>
                <SortColumn view={presenter.table} column="changed_at">
                  Last moved
                </SortColumn>
                <Head>Created by</Head>
                <SortColumn view={presenter.table} column="created_at">
                  Created
                </SortColumn>
                <SortColumn view={presenter.table} column="updated_at">
                  Updated
                </SortColumn>
              </tr>
            </thead>
            <tbody>
              <Show when={presenter.table.rows().length === 0}>
                <EmptyRow>No project matches that search or filter.</EmptyRow>
              </Show>
              <For each={presenter.table.rows()}>
                {(project) => {
                  const badge = () => headBadge(project.head);
                  return (
                    <Row>
                      <Cell>
                        <div class="grid gap-0.5">
                          <a
                            class="inline-flex w-fit max-w-[28rem] items-center gap-1.5 font-semibold text-link hover:underline"
                            href={href(`/projects/${project.slug}`)}
                            onClick={(event) => {
                              event.preventDefault();
                              navigate(`/projects/${project.slug}`);
                            }}
                          >
                            <Icon name="folder" class="h-4 w-4 shrink-0 text-muted" />
                            <span class="min-w-0 truncate" title={project.name}>
                              {project.name}
                            </span>
                          </a>
                          {/* One line under the name, not two. The slug never wraps (one word, no
                              spaces) and the description is a sentence, so stacking them gave a
                              two-word project a three-line row. */}
                          <span class="flex max-w-[28rem] items-baseline gap-1.5 text-xs text-muted">
                            <code class="shrink-0" title={project.slug}>
                              {project.slug}
                            </code>
                            <Show when={project.description}>
                              {(text) => (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span class="min-w-0 truncate" title={text()}>
                                    {text()}
                                  </span>
                                </>
                              )}
                            </Show>
                          </span>
                        </div>
                      </Cell>
                      <Cell>
                        {/* Every other status badge here comes from a fixed short label, but
                            "at_state" puts the state's own name in the pill, and a state name
                            is free text up to 80 characters. */}
                        <Badge variant={badge().tone}>
                          <span class="max-w-[12rem] truncate" title={badge().label}>
                            {badge().label}
                          </span>
                        </Badge>
                      </Cell>
                      <Cell>
                        <Show
                          when={project.head.changed_at}
                          fallback={<span class="text-muted">—</span>}
                        >
                          {(changedAt) => <>{formatWhen(changedAt())}</>}
                        </Show>
                      </Cell>
                      <Cell>
                        <Truncated class="max-w-[12rem]">{project.created_by_label}</Truncated>
                      </Cell>
                      <Cell>{formatWhen(project.created_at)}</Cell>
                      <Cell>{formatWhen(project.updated_at)}</Cell>
                    </Row>
                  );
                }}
              </For>
            </tbody>
          </Table>
          <TableFooter
            shown={presenter.table.rows().length}
            noun="projects"
            hasMore={presenter.hasMore()}
            total={presenter.total()}
          >
            <LoadMore when={presenter.hasMore()} onMore={() => presenter.loadMore()} />
          </TableFooter>
        </Show>
      </Loading>
      <CreateDialog presenter={presenter} />
    </section>
  );
}

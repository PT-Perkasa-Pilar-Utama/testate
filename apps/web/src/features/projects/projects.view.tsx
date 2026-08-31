import type { JSX } from "@solidjs/web";
import FormErrors from "@/components/form-errors.tsx";
import { createFormGuard } from "@/lib/form.ts";
import PageHeader from "@/components/page-header.tsx";
import { formatWhen } from "@/lib/format.ts";
import { For, Loading, Show } from "solid-js";

import Badge from "@/components/badge.tsx";
import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import EmptyState from "@/components/empty-state.tsx";
import Icon from "@/components/icon.tsx";
import LoadMore from "@/components/load-more.tsx";
import Dialog from "@/components/dialog.tsx";
import Input from "@/components/input.tsx";
import { Cell, Head, Row, Table, TableFooter } from "@/components/table.tsx";
import { href, navigate } from "@/lib/router.ts";
import { hasRole } from "@/lib/session.ts";
import { headBadge } from "./projects.format.ts";
import { createProjectsPresenter } from "./projects.presenter.ts";
import type { ProjectsPresenter } from "./projects.presenter.ts";

function CreateDialog(props: { presenter: ProjectsPresenter }): JSX.Element {
  const guard = createFormGuard();
  return (
    <Dialog
      open={props.presenter.creating()}
      onClose={() => props.presenter.closeCreate()}
      title="New project"
      description="A project groups adapters and the states taken across them."
    >
      <form
        ref={guard.ref}
        novalidate
        class="grid gap-4"
        onSubmit={(event) => {
          if (!guard.accepts(event)) return;
          void props.presenter.create();
        }}
      >
        <FormErrors errors={guard.errors()} />
        <label class="grid gap-1.5 text-sm">
          <span>Name</span>
          <Input
            required
            value={props.presenter.name()}
            onInput={(event) => props.presenter.setName(event.currentTarget.value)}
          />
        </label>
        <label class="grid gap-1.5 text-sm">
          <span>Slug</span>
          <Input
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            value={props.presenter.slug()}
            onInput={(event) => props.presenter.setSlug(event.currentTarget.value)}
          />
        </label>
        <Show when={props.presenter.error()}>
          {(message) => <Banner variant="error">{message()}</Banner>}
        </Show>
        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => props.presenter.closeCreate()}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Create
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

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

export default function ProjectsView(): JSX.Element {
  const presenter = createProjectsPresenter();
  return (
    <section class="grid gap-6">
      <PageHeader
        title="Projects"
        description="Each project owns its adapters and states."
        actions={<NewProjectButton presenter={presenter} />}
      />
      <Loading fallback={<p class="text-muted">Loading projects...</p>}>
        <Show
          when={presenter.value().length > 0}
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
                <Head>Project</Head>
                <Head>HEAD</Head>
                <Head>Last moved</Head>
              </tr>
            </thead>
            <tbody>
              <For each={presenter.value()}>
                {(project) => {
                  const badge = () => headBadge(project.head);
                  return (
                    <Row>
                      <Cell>
                        <div class="grid gap-0.5">
                          <a
                            class="inline-flex w-fit items-center gap-1.5 font-semibold text-link hover:underline"
                            href={href(`/projects/${project.slug}`)}
                            onClick={(event) => {
                              event.preventDefault();
                              navigate(`/projects/${project.slug}`);
                            }}
                          >
                            <Icon name="folder" class="h-4 w-4 shrink-0 text-muted" />
                            {project.name}
                          </a>
                          <code class="text-xs text-muted">{project.slug}</code>
                        </div>
                      </Cell>
                      <Cell>
                        <Badge variant={badge().tone}>{badge().label}</Badge>
                      </Cell>
                      <Cell class="whitespace-nowrap">
                        <Show
                          when={project.head.changed_at}
                          fallback={<span class="text-muted">—</span>}
                        >
                          {(changedAt) => <>{formatWhen(changedAt())}</>}
                        </Show>
                      </Cell>
                    </Row>
                  );
                }}
              </For>
            </tbody>
          </Table>
          <TableFooter
            shown={presenter.value().length}
            noun="projects"
            hasMore={presenter.hasMore()}
          >
            <LoadMore when={presenter.hasMore()} onMore={() => presenter.loadMore()} />
          </TableFooter>
        </Show>
      </Loading>
      <CreateDialog presenter={presenter} />
    </section>
  );
}

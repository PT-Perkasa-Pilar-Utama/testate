import type { JSX } from "@solidjs/web";
import PageHeader from "@/components/page-header.tsx";
import { formatWhen } from "@/lib/format.ts";
import { For, Loading, Show } from "solid-js";

import Badge from "@/components/badge.tsx";
import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import LoadMore from "@/components/load-more.tsx";
import Dialog from "@/components/dialog.tsx";
import Input from "@/components/input.tsx";
import { Cell, EmptyRow, Head, Row, Table, TableFooter } from "@/components/table.tsx";
import { href, navigate } from "@/lib/router.ts";
import { hasRole } from "@/lib/session.ts";
import { createProjectsPresenter } from "./projects.presenter.ts";
import type { ProjectsPresenter } from "./projects.presenter.ts";

function CreateDialog(props: { presenter: ProjectsPresenter }): JSX.Element {
  const onSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    void props.presenter.create();
  };
  return (
    <Dialog
      open={props.presenter.creating()}
      onClose={() => props.presenter.closeCreate()}
      title="New project"
      description="A project groups adapters and the states taken across them."
    >
      <form class="grid gap-4" onSubmit={onSubmit}>
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

export default function ProjectsView(): JSX.Element {
  const presenter = createProjectsPresenter();
  return (
    <section class="grid gap-6">
      <PageHeader
        title="Projects"
        description="Each project owns its adapters and states."
        actions={
          <Show when={hasRole("qa")}>
            <Button variant="primary" onClick={() => presenter.openCreate()}>
              New project
            </Button>
          </Show>
        }
      />
      <Loading fallback={<p class="text-kumo-subtle">Loading projects...</p>}>
        <Table>
          <thead>
            <tr>
              <Head>Name</Head>
              <Head>Slug</Head>
              <Head>HEAD</Head>
              <Head>Updated</Head>
            </tr>
          </thead>
          <tbody>
            <Show
              when={presenter.value().length > 0}
              fallback={
                <EmptyRow>
                  No projects yet. A project owns the databases of one system under test.
                </EmptyRow>
              }
            >
              <For each={presenter.value()}>
                {(project) => (
                  <Row>
                    <Cell>
                      <a
                        class="font-semibold text-kumo-link hover:underline"
                        href={href(`/projects/${project.slug}`)}
                        onClick={(event) => {
                          event.preventDefault();
                          navigate(`/projects/${project.slug}`);
                        }}
                      >
                        {project.name}
                      </a>
                    </Cell>
                    <Cell>
                      <code class="text-kumo-subtle">{project.slug}</code>
                    </Cell>
                    <Cell>
                      <Badge variant={project.head.status === "at_state" ? "success" : "warning"}>
                        {project.head.state_name ?? project.head.status}
                      </Badge>
                    </Cell>
                    <Cell class="whitespace-nowrap">{formatWhen(project.updated_at)}</Cell>
                  </Row>
                )}
              </For>
            </Show>
          </tbody>
        </Table>
        <TableFooter shown={presenter.value().length} noun="projects" hasMore={presenter.hasMore()}>
          <LoadMore when={presenter.hasMore()} onMore={() => presenter.loadMore()} />
        </TableFooter>
      </Loading>
      <CreateDialog presenter={presenter} />
    </section>
  );
}

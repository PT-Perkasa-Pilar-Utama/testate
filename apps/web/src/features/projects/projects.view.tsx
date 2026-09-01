import { Field, Form, createForm, getInput, reset } from "@formisch/solid";
import type { JSX } from "@solidjs/web";
import PageHeader from "@/components/page-header.tsx";
import { onceSettled } from "@/lib/form.ts";
import { formatWhen } from "@/lib/format.ts";
import { formatBytes } from "../states/states.format.ts";
import { For, Loading, Show, createEffect } from "solid-js";
import { createProjectSchema, projectSlug } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import EmptyState from "@/components/empty-state.tsx";
import FieldError from "@/components/field-error.tsx";
import FieldLabel from "@/components/field-label.tsx";
import Slider from "@/components/slider.tsx";
import Icon from "@/components/icon.tsx";
import LoadMore from "@/components/load-more.tsx";
import Dialog from "@/components/dialog.tsx";
import Input from "@/components/input.tsx";
import {
  Cell,
  EmptyRow,
  Head,
  Row,
  SortColumn,
  Table,
  TableFooter,
  TableSearch,
  TableToolbar,
  Truncated,
} from "@/components/table.tsx";
import { href, navigate } from "@/lib/router.ts";
import { hasRole } from "@/lib/session.ts";
import { headBadge } from "./projects.format.ts";
import { QUOTA_STEPS, createProjectsPresenter } from "./projects.presenter.ts";
import type { ProjectsPresenter } from "./projects.presenter.ts";

/** The size a step means, with the instance default named rather than left as "default". */
/** Formisch needs a shape to reset to; a missing `initialInput` leaves the fields undefined. */
const BLANK_PROJECT = { name: "", description: "" } as const;

function quotaLabels(inherited: number): string[] {
  return QUOTA_STEPS.map((step) => {
    if (step === null) return `Instance default (${formatBytes(inherited)})`;
    return step === 0 ? "No limit" : formatBytes(step);
  });
}

/** The quota control, the same one the edit dialog uses, so the two cannot drift apart. */
export function QuotaSlider(props: {
  inherited: number;
  index: number;
  onIndex: (index: number) => void;
}): JSX.Element {
  return (
    <div class="grid gap-1.5 text-sm">
      <span class="flex items-center gap-1.5">
        Snapshot quota
        <span class="text-xs font-normal text-muted">optional</span>
      </span>
      <Slider
        label="Snapshot quota"
        steps={quotaLabels(props.inherited)}
        ends={["Default", "No limit"]}
        index={props.index}
        onIndex={(index) => props.onIndex(index)}
      />
    </div>
  );
}

function CreateDialog(props: { presenter: ProjectsPresenter }): JSX.Element {
  const form = createForm({ schema: createProjectSchema, initialInput: BLANK_PROJECT });
  const name = (): string => getInput(form, { path: ["name"] }) ?? "";

  createEffect(
    () => props.presenter.creating(),
    (open) => {
      if (open) onceSettled(() => reset(form, { initialInput: BLANK_PROJECT }));
    }
  );

  return (
    <Dialog
      open={props.presenter.creating()}
      onClose={() => props.presenter.closeCreate()}
      title="New project"
      description="A project groups adapters and the states taken across them."
    >
      <Form of={form} class="grid gap-4" onSubmit={(input) => props.presenter.submit(input)}>
        <Field of={form} path={["name"]}>
          {(field) => (
            <label class="grid gap-1.5 text-sm">
              <FieldLabel required>Name</FieldLabel>
              <Input
                {...field.props}
                required
                value={field.input}
                variant={field.errors ? "error" : "default"}
                aria-invalid={field.errors ? "true" : undefined}
              />
              <FieldError message={field.errors?.[0]} />
            </label>
          )}
        </Field>
        <Field of={form} path={["description"]}>
          {(field) => (
            <label class="grid gap-1.5 text-sm">
              <FieldLabel required={false}>Description</FieldLabel>
              <Input
                {...field.props}
                maxlength="2000"
                value={field.input}
                variant={field.errors ? "error" : "default"}
                aria-invalid={field.errors ? "true" : undefined}
              />
              <FieldError message={field.errors?.[0]} />
            </label>
          )}
        </Field>
        {/* Read-only, and a preview rather than the answer: the API adds `-2` if the slug is taken,
            and only it knows what is taken. */}
        <label class="grid gap-1.5 text-sm">
          <span>URL</span>
          <Input
            readonly
            tabindex="-1"
            aria-label="URL"
            value={`/projects/${projectSlug(name())}`}
          />
        </label>
        <Show when={hasRole("admin")}>
          <Loading fallback={<p class="text-sm text-muted">Reading the instance default...</p>}>
            <QuotaSlider
              inherited={props.presenter.defaults.value().quota_bytes}
              index={props.presenter.quotaIndex()}
              onIndex={(index) => props.presenter.setQuotaIndex(index)}
            />
          </Loading>
        </Show>
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
      </Form>
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
          <TableToolbar>
            <TableSearch
              label="Search projects"
              placeholder="name or slug"
              value={presenter.table.query()}
              onInput={(value) => presenter.table.setQuery(value)}
            />
          </TableToolbar>
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
              </tr>
            </thead>
            <tbody>
              <Show when={presenter.table.rows().length === 0}>
                <EmptyRow>No project matches that search.</EmptyRow>
              </Show>
              <For each={presenter.table.rows()}>
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
                          {/* The description was collected in the edit dialog and shown nowhere.
                              It belongs where you are choosing between projects. */}
                          <Show when={project.description}>
                            {(text) => (
                              <Truncated class="max-w-[28rem] text-xs text-muted">
                                {text()}
                              </Truncated>
                            )}
                          </Show>
                        </div>
                      </Cell>
                      <Cell>
                        <Badge variant={badge().tone}>{badge().label}</Badge>
                      </Cell>
                      <Cell>
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

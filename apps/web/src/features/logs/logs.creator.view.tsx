import type { JSX } from "@solidjs/web";
import { Loading, Show, createSignal } from "solid-js";

import Button, { buttonClass } from "@/components/button.tsx";
import Icon from "@/components/icon.tsx";
import { Menu, MenuItem } from "@/components/menu.tsx";
import { createRefreshable } from "@/lib/async.ts";
import { projectsModel } from "../projects/projects.model.ts";
import { createLogfileFormPresenter } from "./logs.form.ts";
import { LogfileDialog } from "./logs.form.view.tsx";
import type { ProjectPick } from "./logs.form.view.tsx";
import { createIngestPresenter } from "./logs.ingest.ts";
import { IngestDialog, IngestReveal } from "./logs.ingest.view.tsx";

/** Built once the projects are known; the project is picked inside each dialog, as on Storage. */
function Creator(props: {
  projects: { value: string; label: string }[];
  onCreated: () => void;
}): JSX.Element {
  const [picked, setPicked] = createSignal("");
  const slug = (): string => picked() || (props.projects[0]?.value ?? "");
  const files = createLogfileFormPresenter(slug, () => props.onCreated());
  const ingest = createIngestPresenter(slug, () => props.onCreated());
  const project = (): ProjectPick => ({
    options: props.projects,
    value: slug(),
    onChange: setPicked,
  });
  // A type first (I8): the two kinds ask for different things, so each has its own dialog.
  return (
    <>
      <Show
        when={props.projects.length > 0}
        fallback={
          <Button variant="primary" disabled title="Create a project first">
            <Icon name="plus" class="h-4 w-4" />
            New log adapter
          </Button>
        }
      >
        <Menu
          label="New log adapter"
          trigger={
            <span class={buttonClass("primary")}>
              <Icon name="plus" class="h-4 w-4" />
              New log adapter
              <Icon name="chevron-down" class="h-4 w-4" />
            </span>
          }
          panelClass="min-w-60"
        >
          <MenuItem onClick={() => files.openCreate()}>Files over SFTP or S3</MenuItem>
          <MenuItem onClick={() => ingest.openCreate()}>Push from your app</MenuItem>
        </Menu>
      </Show>
      <LogfileDialog presenter={files} project={project()} />
      <IngestDialog presenter={ingest} project={project()} />
      <IngestReveal presenter={ingest} />
    </>
  );
}

export function NewLogSource(props: { onCreated: () => void }): JSX.Element {
  const projects = createRefreshable(() => projectsModel.list());
  const options = (): { value: string; label: string }[] =>
    projects.value().map((project) => ({ value: project.slug, label: project.name }));
  return (
    <Loading fallback={<span />}>
      <Creator projects={options()} onCreated={() => props.onCreated()} />
    </Loading>
  );
}

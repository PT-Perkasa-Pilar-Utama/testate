import type { JSX } from "@solidjs/web";
import { Loading, createSignal } from "solid-js";

import Button from "@/components/button.tsx";
import Icon from "@/components/icon.tsx";
import { createRefreshable } from "@/lib/async.ts";
import { projectsModel } from "../projects/projects.model.ts";
import { createLogfileFormPresenter } from "./logs.form.ts";
import { LogfileDialog } from "./logs.form.view.tsx";

/** Built once the projects are known; the project is picked inside the dialog, as on Storage. */
function Creator(props: {
  projects: { value: string; label: string }[];
  onCreated: () => void;
}): JSX.Element {
  const [picked, setPicked] = createSignal("");
  const slug = (): string => picked() || (props.projects[0]?.value ?? "");
  const presenter = createLogfileFormPresenter(slug, () => props.onCreated());
  return (
    <>
      <Button
        variant="primary"
        disabled={props.projects.length === 0}
        title={props.projects.length === 0 ? "Create a project first" : undefined}
        onClick={() => presenter.openCreate()}
      >
        <Icon name="plus" class="h-4 w-4" />
        New log adapter
      </Button>
      <LogfileDialog
        presenter={presenter}
        project={{ options: props.projects, value: slug(), onChange: setPicked }}
      />
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

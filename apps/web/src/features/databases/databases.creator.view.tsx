import type { JSX } from "@solidjs/web";
import { createSignal, untrack } from "solid-js";

import Button from "@/components/button.tsx";
import { CreateDialog } from "../adapters/adapters.create.view.tsx";
import { createAdaptersPresenter } from "../adapters/adapters.presenter.ts";
import { firstPickable } from "./databases.presenter.ts";
import type { ProjectOption } from "./databases.presenter.ts";

/**
 * "New database", with the project picked inside the dialog, as Storage does. A project not at its
 * starting point is greyed out with the reason (Q2). Built once the projects are known, so the
 * picker never reads a pending value.
 */
export default function DatabaseCreator(props: {
  options: ProjectOption[];
  /** The project the screen is filtered to, picked first when it may take a database. */
  wanted: string;
  /** Opened straight away: a project's "Add a database" sent the reader here. */
  openNow: boolean;
  onCreated: () => void;
}): JSX.Element {
  const [picked, setPicked] = createSignal(
    untrack(() => firstPickable(props.options, props.wanted))
  );
  const presenter = createAdaptersPresenter(picked, () => props.onCreated());
  const usable = (): boolean => props.options.some((option) => !option.disabled);
  if (untrack(() => props.openNow && usable())) presenter.openCreate();
  return (
    <>
      <Button
        variant="primary"
        disabled={!usable()}
        title={usable() ? undefined : "No project can take a database right now"}
        onClick={() => presenter.openCreate()}
      >
        New database
      </Button>
      <CreateDialog
        presenter={presenter}
        kind="database"
        readOnly={props.options.find((option) => option.value === picked())?.inspect === true}
        project={{ options: props.options, value: picked(), onChange: setPicked }}
      />
    </>
  );
}

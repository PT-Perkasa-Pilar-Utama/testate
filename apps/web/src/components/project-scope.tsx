import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { ScopeChoice } from "@testate/shared";

import FieldError from "./field-error.tsx";
import FieldLabel from "./field-label.tsx";

export type ScopeProject = { id: string; name: string };

const CHOICES: readonly { value: ScopeChoice; label: string; hint: string }[] = [
  { value: "all", label: "All projects", hint: "Every project, and every one created later." },
  { value: "chosen", label: "Chosen projects", hint: "Only the projects ticked below." },
];

/**
 * Which projects a token or a user reaches (#55). Neither answer is preselected: the form refuses
 * until someone makes the choice. Plain values in, callbacks out, so the token and the user
 * dialogs wire it to their own forms.
 *
 * Both radios carry `required`. That is the screen reader's cue, and `e2e/lib/crawl.ts` checks
 * the first radio of a required group to get the dialog submitted.
 */
export default function ProjectScope(props: {
  projects: readonly ScopeProject[];
  scope: ScopeChoice | undefined;
  picked: readonly string[];
  onScope: (scope: ScopeChoice) => void;
  onPicked: (picked: string[]) => void;
  scopeError?: string | undefined;
  pickedError?: string | undefined;
}): JSX.Element {
  const toggle = (id: string, on: boolean): void =>
    props.onPicked(on ? [...props.picked, id] : props.picked.filter((each) => each !== id));
  return (
    <fieldset class="grid gap-2 text-base">
      <legend class="mb-1.5">
        <FieldLabel required={true}>Projects</FieldLabel>
      </legend>
      <div class="grid gap-2 sm:grid-cols-2">
        <For each={CHOICES}>
          {(choice) => (
            <label class="flex cursor-pointer items-start gap-2 rounded-md bg-control px-3 py-2.5 ring ring-line">
              <span class="flex h-lh items-center">
                <input
                  type="radio"
                  name="scope"
                  required
                  value={choice.value}
                  checked={props.scope === choice.value}
                  aria-invalid={props.scopeError === undefined ? undefined : "true"}
                  onChange={() => props.onScope(choice.value)}
                />
              </span>
              <span class="grid gap-0.5">
                <span>{choice.label}</span>
                <span class="text-sm text-muted">{choice.hint}</span>
              </span>
            </label>
          )}
        </For>
      </div>
      <FieldError message={props.scopeError} />
      <Show when={props.scope === "chosen"}>
        <Show
          when={props.projects.length > 0}
          fallback={<p class="text-sm text-muted">There are no projects yet.</p>}
        >
          <ul
            class="grid max-h-48 gap-1 overflow-y-auto rounded-md bg-sunken p-2 ring ring-line"
            aria-label="Projects to reach"
          >
            <For each={props.projects}>
              {(project) => (
                <li>
                  <label class="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1 hover:bg-hover">
                    <input
                      type="checkbox"
                      checked={props.picked.includes(project.id)}
                      onChange={(event) => toggle(project.id, event.currentTarget.checked)}
                    />
                    <span class="truncate" title={project.name}>
                      {project.name}
                    </span>
                  </label>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <FieldError message={props.pickedError} />
      </Show>
    </fieldset>
  );
}

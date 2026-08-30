import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

import Badge from "@/components/badge.tsx";
import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import Dialog from "@/components/dialog.tsx";
import Input from "@/components/input.tsx";
import { Cell, Head, Row, Table } from "@/components/table.tsx";
import { hasRole } from "@/lib/session.ts";
import type { DeletionAffected } from "../projects/projects.model.ts";
import type { ProjectPresenter } from "./project.presenter.ts";

/** What the delete takes with it, in the order a reader cares about; zeroes stay out of the way. */
const AFFECTED_LABELS: [keyof DeletionAffected, string][] = [
  ["adapters", "adapter"],
  ["states", "state"],
  ["protected_states", "of them protected"],
  ["checkouts", "checkout"],
  ["diffs", "diff"],
  ["import_runs", "import run"],
  ["saved_queries", "saved query"],
  ["hooks", "hook"],
  ["tokens", "token scoped to this project"],
];

function plural(count: number, label: string): string {
  const many = label.endsWith("y") ? `${label.slice(0, -1)}ies` : `${label}s`;
  return `${count} ${count === 1 || label.startsWith("of them") ? label : many}`;
}

export function AffectedList(props: { affected: DeletionAffected }): JSX.Element {
  const rows = (): string[] =>
    AFFECTED_LABELS.filter(([key]) => props.affected[key] > 0).map(([key, label]) =>
      plural(props.affected[key], label)
    );
  return (
    <Show when={rows().length > 0} fallback={<p class="text-sm">The project holds nothing yet.</p>}>
      <ul class="grid gap-1 text-sm">
        <For each={rows()}>{(row) => <li>{row} will be deleted</li>}</For>
      </ul>
    </Show>
  );
}

export function EditDialog(props: { presenter: ProjectPresenter }): JSX.Element {
  const onSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    void props.presenter.save();
  };
  return (
    <Dialog
      open={props.presenter.editing()}
      onClose={() => props.presenter.closeEdit()}
      title="Edit project"
    >
      <form class="grid gap-4" onSubmit={onSubmit}>
        <label class="grid gap-1.5 text-sm">
          <span>Name</span>
          <Input
            required
            maxlength="120"
            value={props.presenter.draft().name}
            onInput={(event) => props.presenter.setDraft({ name: event.currentTarget.value })}
          />
        </label>
        <label class="grid gap-1.5 text-sm">
          <span>Description</span>
          <Input
            maxlength="2000"
            value={props.presenter.draft().description}
            onInput={(event) =>
              props.presenter.setDraft({ description: event.currentTarget.value })
            }
          />
        </label>
        <Show when={hasRole("admin")}>
          <label class="grid gap-1.5 text-sm">
            <span>Snapshot quota in GiB (empty = instance default)</span>
            <Input
              type="number"
              min="0"
              step="0.5"
              value={props.presenter.draft().quota_gib}
              onInput={(event) =>
                props.presenter.setDraft({ quota_gib: event.currentTarget.value })
              }
            />
          </label>
        </Show>
        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => props.presenter.closeEdit()}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

const ACTION_VARIANT = {
  restore: "success",
  force: "warning",
  skip: "secondary",
  none: "outline",
} as const;

export function DeleteDialog(props: { presenter: ProjectPresenter; slug: string }): JSX.Element {
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
          title={`Delete ${props.slug}`}
          description="This cannot be undone. Read what goes with the project, then type its slug."
          size="lg"
        >
          <form class="grid gap-4" onSubmit={onSubmit}>
            <Banner variant="alert">
              Every writable database below returns to its init state. That restore is not stashed:
              anything the databases hold now, and every state that could bring it back, is gone.
              Download the archive of a state you still want before you delete. The plan expires at{" "}
              {plan().expires_at}.
            </Banner>
            <AffectedList affected={plan().affected} />
            <Table>
              <thead>
                <tr>
                  <Head>Adapter</Head>
                  <Head>Engine</Head>
                  <Head>Action</Head>
                </tr>
              </thead>
              <tbody>
                <For each={plan().adapters}>
                  {(adapter) => (
                    <Row>
                      <Cell>{adapter.name}</Cell>
                      <Cell>{adapter.engine}</Cell>
                      <Cell>
                        <Badge variant={ACTION_VARIANT[adapter.action]}>
                          {adapter.reason === undefined
                            ? adapter.action
                            : `${adapter.action} (${adapter.reason})`}
                        </Badge>
                      </Cell>
                    </Row>
                  )}
                </For>
              </tbody>
            </Table>
            <label class="grid gap-1.5 text-sm">
              <span>Type the slug to confirm</span>
              <Input
                required
                autocomplete="off"
                placeholder={props.slug}
                value={props.presenter.confirmSlug()}
                onInput={(event) => props.presenter.setConfirmSlug(event.currentTarget.value)}
              />
            </label>
            <div class="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => props.presenter.closeDelete()}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={props.presenter.confirmSlug() !== props.slug}
              >
                Return to init and delete
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </Show>
  );
}

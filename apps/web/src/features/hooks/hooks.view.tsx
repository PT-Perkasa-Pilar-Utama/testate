import type { JSX } from "@solidjs/web";
import { For, Loading, Show } from "solid-js";
import { HOOK_TRIGGERS } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import Dialog from "@/components/dialog.tsx";
import Select from "@/components/select.tsx";
import { Cell, Head, Row, Table, EmptyRow } from "@/components/table.tsx";
import { hasRole } from "@/lib/session.ts";
import { createHooksPresenter } from "./hooks.presenter.ts";
import type { HooksPresenter } from "./hooks.presenter.ts";

const TRIGGER_OPTIONS = HOOK_TRIGGERS.map((value) => ({ value, label: value }));
const POLICY_OPTIONS = [
  { value: "continue", label: "continue (log and go on)" },
  { value: "abort", label: "abort the job" },
] as const;

function CreateDialog(props: { presenter: HooksPresenter }): JSX.Element {
  const onSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    void props.presenter.create();
  };
  return (
    <Dialog
      open={props.presenter.creating()}
      onClose={() => props.presenter.close()}
      title="New hook"
      description="A saved REST request runs at the trigger. Its path, query, headers, and body may use {{project.slug}}, {{state.name}}, {{state.id}}, and {{job.id}}."
    >
      <form class="grid gap-4" onSubmit={onSubmit}>
        <label class="grid gap-1.5 text-base">
          <span>Trigger</span>
          <Select
            options={TRIGGER_OPTIONS}
            value={props.presenter.draft().trigger}
            onChange={(trigger) => props.presenter.setDraft({ trigger })}
          />
        </label>
        <Loading fallback={<p class="text-kumo-subtle">Listing REST adapters...</p>}>
          <label class="grid gap-1.5 text-base">
            <span>REST adapter</span>
            <Select
              options={[
                { value: "", label: "choose an adapter" },
                ...props.presenter.restAdapters
                  .value()
                  .map((adapter) => ({ value: adapter.id, label: adapter.name })),
              ]}
              value={props.presenter.draft().adapter_id}
              onChange={(adapter_id) =>
                props.presenter.setDraft({ adapter_id, rest_request_id: "" })
              }
            />
          </label>
          <label class="grid gap-1.5 text-base">
            <span>Saved request</span>
            <Select
              options={[
                { value: "", label: "choose a request" },
                ...props.presenter.requests
                  .value()
                  .map((request) => ({ value: request.id, label: request.name })),
              ]}
              value={props.presenter.draft().rest_request_id}
              onChange={(rest_request_id) => props.presenter.setDraft({ rest_request_id })}
            />
          </label>
        </Loading>
        <label class="grid gap-1.5 text-base">
          <span>On failure</span>
          <Select
            options={POLICY_OPTIONS}
            value={props.presenter.draft().fail_policy}
            onChange={(fail_policy) => props.presenter.setDraft({ fail_policy })}
          />
        </label>
        <Show when={props.presenter.error()}>
          {(message) => <Banner variant="error">{message()}</Banner>}
        </Show>
        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => props.presenter.close()}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={props.presenter.draft().rest_request_id === ""}
          >
            Add hook
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function HooksView(props: { slug: string }): JSX.Element {
  const presenter = createHooksPresenter(() => props.slug);
  return (
    <div class="grid gap-3">
      <Show when={hasRole("qa")}>
        <div class="flex justify-end">
          <Button variant="primary" onClick={() => presenter.openCreate()}>
            New hook
          </Button>
        </div>
      </Show>
      <Loading fallback={<p class="text-kumo-subtle">Loading hooks...</p>}>
        <Table>
          <thead>
            <tr>
              <Head>Order</Head>
              <Head>Trigger</Head>
              <Head>Request</Head>
              <Head>On failure</Head>
              <Head>Enabled</Head>
              <Head>Actions</Head>
            </tr>
          </thead>
          <tbody>
            <Show
              when={presenter.value().length > 0}
              fallback={
                <EmptyRow>
                  No hooks yet. Attach a saved request to run before or after a checkout.
                </EmptyRow>
              }
            >
              <For each={presenter.value()}>
                {(hook) => (
                  <Row>
                    <Cell>{hook.position}</Cell>
                    <Cell>
                      <code>{hook.trigger}</code>
                    </Cell>
                    <Cell>{hook.request.name}</Cell>
                    <Cell>{hook.fail_policy}</Cell>
                    <Cell>
                      <Badge variant={hook.enabled ? "success" : "secondary"}>
                        {hook.enabled ? "on" : "off"}
                      </Badge>
                    </Cell>
                    <Cell>
                      <Show when={hasRole("qa")}>
                        <div class="flex flex-wrap justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void presenter.move(hook, -1)}
                          >
                            Move up
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void presenter.move(hook, 1)}
                          >
                            Move down
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              void presenter.setPolicy(
                                hook,
                                hook.fail_policy === "abort" ? "continue" : "abort"
                              )
                            }
                          >
                            {hook.fail_policy === "abort"
                              ? "Continue on failure"
                              : "Abort on failure"}
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => void presenter.setEnabled(hook, !hook.enabled)}
                          >
                            {hook.enabled ? "Disable" : "Enable"}
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => void presenter.remove(hook)}
                          >
                            Delete
                          </Button>
                        </div>
                      </Show>
                    </Cell>
                  </Row>
                )}
              </For>
            </Show>
          </tbody>
        </Table>
      </Loading>
      <CreateDialog presenter={presenter} />
    </div>
  );
}

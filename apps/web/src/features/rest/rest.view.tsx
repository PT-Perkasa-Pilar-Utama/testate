import type { JSX } from "@solidjs/web";
import { For, Loading, Show } from "solid-js";
import type { RestRun } from "@testate/shared";

import Badge from "@/components/badge.tsx";
import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import Dialog from "@/components/dialog.tsx";
import Input from "@/components/input.tsx";
import InputArea from "@/components/input-area.tsx";
import Select from "@/components/select.tsx";
import { Cell, Head, Row, Table } from "@/components/table.tsx";
import { href, navigate } from "@/lib/router.ts";
import { hasRole } from "@/lib/session.ts";
import { METHOD_OPTIONS, createRestPresenter } from "./rest.presenter.ts";
import type { RestPresenter } from "./rest.presenter.ts";

function statusVariant(run: RestRun): "success" | "error" | "warning" {
  if (run.error !== null || run.status_code === null) return "error";
  return run.matched_expected === false ? "warning" : "success";
}

function CreateDialog(props: { presenter: RestPresenter }): JSX.Element {
  const onSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    void props.presenter.create();
  };
  const field = (
    label: string,
    key: "name" | "path" | "expected_status",
    placeholder = ""
  ): JSX.Element => (
    <Show when={props.presenter.draft()}>
      {(draft) => (
        <label class="grid gap-1.5 text-sm">
          <span>{label}</span>
          <Input
            placeholder={placeholder}
            value={draft()[key]}
            onInput={(event) => props.presenter.setDraft({ [key]: event.currentTarget.value })}
          />
        </label>
      )}
    </Show>
  );
  const area = (label: string, key: "query" | "headers" | "secrets" | "body"): JSX.Element => (
    <Show when={props.presenter.draft()}>
      {(draft) => (
        <label class="grid gap-1.5 text-sm">
          <span>{label}</span>
          <InputArea
            rows={3}
            class="font-mono"
            value={draft()[key]}
            onInput={(event) => props.presenter.setDraft({ [key]: event.currentTarget.value })}
          />
        </label>
      )}
    </Show>
  );
  return (
    <Show when={props.presenter.draft()}>
      {(draft) => (
        <Dialog
          open
          size="lg"
          onClose={() => props.presenter.closeCreate()}
          title="New request"
          description="Placeholders {{project.slug}}, {{state.name}}, {{state.id}}, and {{job.id}} expand at run time. Secret headers are sealed."
        >
          <form class="grid gap-3" onSubmit={onSubmit}>
            {field("Name", "name")}
            <label class="grid gap-1.5 text-sm">
              <span>Method</span>
              <Select
                options={METHOD_OPTIONS}
                value={draft().method}
                onChange={(method) => props.presenter.setDraft({ method })}
              />
            </label>
            {field("Path (relative to the base URL)", "path", "/orders/{{state.name}}")}
            {area("Query (key=value per line)", "query")}
            {area("Headers (key=value per line)", "headers")}
            {area("Secret headers (key=value per line)", "secrets")}
            {area("Body", "body")}
            {field("Expected status (blank for any)", "expected_status", "200")}
            <Show when={props.presenter.error()}>
              {(message) => <Banner variant="error">{message()}</Banner>}
            </Show>
            <div class="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => props.presenter.closeCreate()}>
                Cancel
              </Button>
              <Button type="submit" variant="primary">
                Save
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </Show>
  );
}

function RunPanel(props: { presenter: RestPresenter }): JSX.Element {
  return (
    <Show when={props.presenter.selected()}>
      {(request) => (
        <aside class="grid content-start gap-3">
          <h3 class="font-medium">
            {request().method} <code>{request().path}</code>
          </h3>
          <Show when={props.presenter.lastRun()}>
            {(run) => (
              <div class="grid gap-2">
                <div class="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant={statusVariant(run())}>{run().status_code ?? "no response"}</Badge>
                  <span class="text-kumo-subtle">{run().duration_ms} ms</span>
                  <Show when={run().truncated}>
                    <Badge variant="warning">body truncated</Badge>
                  </Show>
                  <Show when={run().error}>
                    {(error) => <span class="text-kumo-danger">{error()}</span>}
                  </Show>
                </div>
                <pre class="max-h-64 overflow-auto rounded-lg bg-kumo-fill p-3 text-xs">
                  {run().response_body ?? ""}
                </pre>
              </div>
            )}
          </Show>
          <h4 class="text-sm font-medium">Recent runs</h4>
          <Loading fallback={<p class="text-kumo-subtle">Loading...</p>}>
            <ul class="grid gap-1 text-sm">
              <For each={props.presenter.runs.value()}>
                {(run) => (
                  <li class="flex items-center gap-2">
                    <Badge variant={statusVariant(run)}>{run.status_code ?? "—"}</Badge>
                    <span class="text-kumo-subtle">
                      {run.created_at} · {run.duration_ms} ms
                      {run.error === null ? "" : ` · ${run.error}`}
                    </span>
                  </li>
                )}
              </For>
            </ul>
          </Loading>
        </aside>
      )}
    </Show>
  );
}

/** Saved requests on a REST adapter with runs and their history (api 12, stories 98-100). */
export default function RestView(props: { slug: string; id: string }): JSX.Element {
  const presenter = createRestPresenter(
    () => props.slug,
    () => props.id
  );
  const back = (): string => `/projects/${props.slug}/adapters/${props.id}`;
  const onBack = (event: MouseEvent): void => {
    event.preventDefault();
    navigate(back());
  };
  return (
    <section class="grid gap-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-lg font-semibold">
          <a class="text-kumo-subtle hover:underline" href={href(back())} onClick={onBack}>
            adapter
          </a>{" "}
          / requests
        </h2>
        <Show when={hasRole("qa")}>
          <Button variant="primary" onClick={() => presenter.openCreate()}>
            New request
          </Button>
        </Show>
      </div>
      <div class="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Loading fallback={<p class="text-kumo-subtle">Loading requests...</p>}>
          <Table>
            <thead>
              <tr>
                <Head>Name</Head>
                <Head>Method</Head>
                <Head>Path</Head>
                <Head>Expected</Head>
                <Head />
              </tr>
            </thead>
            <tbody>
              <For each={presenter.requests.value()}>
                {(request) => (
                  <Row>
                    <Cell>
                      <button
                        type="button"
                        class="cursor-pointer hover:underline"
                        onClick={() => presenter.select(request)}
                      >
                        {request.name}
                      </button>
                    </Cell>
                    <Cell>
                      <Badge variant="outline">{request.method}</Badge>
                    </Cell>
                    <Cell>
                      <code>{request.path}</code>
                    </Cell>
                    <Cell>{request.expected_status ?? "any"}</Cell>
                    <Cell>
                      <Show when={hasRole("qa")}>
                        <div class="flex gap-1">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => void presenter.run(request)}
                          >
                            Run
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void presenter.remove(request)}
                          >
                            Delete
                          </Button>
                        </div>
                      </Show>
                    </Cell>
                  </Row>
                )}
              </For>
            </tbody>
          </Table>
        </Loading>
        <RunPanel presenter={presenter} />
      </div>
      <CreateDialog presenter={presenter} />
    </section>
  );
}

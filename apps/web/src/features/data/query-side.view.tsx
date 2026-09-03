import type { JSX } from "@solidjs/web";
import { formatWhen } from "@/lib/format.ts";
import { For, Loading, Show, createSignal } from "solid-js";

import Button from "@/components/button.tsx";
import Pending from "@/components/pending.tsx";
import Input from "@/components/input.tsx";
import Tabs from "@/components/tabs.tsx";
import { hasRole } from "@/lib/session.ts";
import type { QueryPresenter } from "./query.presenter.ts";

const SIDE_TABS = [
  { id: "saved", label: "Saved" },
  { id: "history", label: "History" },
  { id: "running", label: "Running" },
] as const;
type SideTab = (typeof SIDE_TABS)[number]["id"];

export default function SidePanel(props: { presenter: QueryPresenter }): JSX.Element {
  const [tab, setTab] = createSignal<SideTab>("saved");
  return (
    <aside class="grid content-start gap-3">
      <Tabs
        items={SIDE_TABS}
        value={tab()}
        onChange={setTab}
        label="Query lists"
        variant="segmented"
      />
      <Show when={tab() === "saved"}>
        <Loading fallback={<Pending>Loading...</Pending>}>
          <ul class="grid gap-1 text-base">
            <For each={props.presenter.saved.value()}>
              {(query) => (
                <li class="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    class="cursor-pointer hover:underline"
                    onClick={() => props.presenter.load(query)}
                  >
                    {query.name}
                  </button>
                  <Show when={hasRole("qa")}>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void props.presenter.removeSaved(query.id)}
                    >
                      Delete
                    </Button>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Loading>
        <Show when={hasRole("qa")}>
          <form
            class="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void props.presenter.save();
            }}
          >
            <Input
              size="sm"
              required
              placeholder="save as..."
              value={props.presenter.saveName()}
              onInput={(event) => props.presenter.setSaveName(event.currentTarget.value)}
            />
            <Button type="submit" size="sm" variant="secondary">
              Save
            </Button>
          </form>
        </Show>
      </Show>
      <Show when={tab() === "history"}>
        <Loading fallback={<Pending>Loading...</Pending>}>
          <ul class="grid gap-1 text-sm">
            <For each={props.presenter.history.value()}>
              {(row) => (
                <li class="grid gap-0.5 border-b border-line py-1">
                  <button
                    type="button"
                    class="cursor-pointer text-left hover:underline"
                    title="Load into the editor"
                    onClick={() => props.presenter.loadHistory(row)}
                  >
                    <code class="block truncate">{row.query_text}</code>
                  </button>
                  <span class="text-xs text-muted">
                    {formatWhen(row.created_at)} · {row.duration_ms ?? "?"} ms ·{" "}
                    {row.row_count ?? "?"} rows
                    {row.error === null ? "" : ` · ${row.error}`}
                  </span>
                </li>
              )}
            </For>
          </ul>
        </Loading>
      </Show>
      <Show when={tab() === "running"}>
        <Button size="sm" variant="ghost" onClick={() => props.presenter.running.refresh()}>
          Refresh
        </Button>
        <Loading fallback={<Pending>Loading...</Pending>}>
          <ul class="grid gap-1 text-sm">
            <For each={props.presenter.running.value()}>
              {(query) => (
                <li class="flex items-center justify-between gap-2">
                  <span>
                    {query.actor} · {query.mode} · {query.duration_ms} ms
                    {query.tag === null ? "" : ` · ${query.tag}`}
                  </span>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => void props.presenter.cancel(query.query_id)}
                  >
                    Cancel
                  </Button>
                </li>
              )}
            </For>
          </ul>
        </Loading>
      </Show>
    </aside>
  );
}

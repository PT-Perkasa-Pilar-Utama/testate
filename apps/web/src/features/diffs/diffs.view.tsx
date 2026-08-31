import type { JSX } from "@solidjs/web";
import { formatWhen } from "@/lib/format.ts";
import { For, Loading, Show } from "solid-js";

import Badge from "@/components/badge.tsx";
import Button, { buttonClass } from "@/components/button.tsx";
import { Cell, Head, Row, Table, EmptyRow } from "@/components/table.tsx";
import { hasRole } from "@/lib/session.ts";
import { DetailDialog } from "./diffs.detail.view.tsx";
import { CreateDialog, RowsDialog } from "./diffs.dialogs.view.tsx";
import { changedRows, createDiffsPresenter, targetLabel } from "./diffs.presenter.ts";

const STATUS_VARIANT = { running: "info", ready: "success", failed: "error" } as const;
const LINK = buttonClass("ghost", "sm");

export default function DiffsView(props: { slug: string }): JSX.Element {
  const presenter = createDiffsPresenter(() => props.slug);
  return (
    <div class="grid gap-3">
      <Show when={hasRole("qa")}>
        <div class="flex justify-end">
          <Button variant="primary" onClick={() => presenter.openCreate()}>
            New diff
          </Button>
        </div>
      </Show>
      <Loading fallback={<p class="text-kumo-subtle">Loading diffs...</p>}>
        <Table>
          <thead>
            <tr>
              <Head>Base</Head>
              <Head>Target</Head>
              <Head>Status</Head>
              <Head numeric>Changed rows</Head>
              <Head>Expires</Head>
              <Head pinned>Actions</Head>
            </tr>
          </thead>
          <tbody>
            <Show
              when={presenter.value().length > 0}
              fallback={
                <EmptyRow>
                  No diffs yet. Compare two states, or a state against what the databases hold now,
                  to see what a test run changed.
                </EmptyRow>
              }
            >
              <For each={presenter.value()}>
                {(diff) => (
                  <Row>
                    <Cell>{diff.base.name}</Cell>
                    <Cell>{targetLabel(diff.target)}</Cell>
                    <Cell>
                      <Badge variant={STATUS_VARIANT[diff.status]}>{diff.status}</Badge>
                    </Cell>
                    <Cell numeric>{changedRows(diff)}</Cell>
                    <Cell class="whitespace-nowrap">{formatWhen(diff.expires_at)}</Cell>
                    <Cell pinned>
                      <div class="flex flex-wrap justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={diff.status !== "ready"}
                          onClick={() => void presenter.openDetail(diff)}
                        >
                          Details
                        </Button>
                        <a class={LINK} href={presenter.exportUrl(diff, "csv")}>
                          CSV
                        </a>
                        <a class={LINK} href={presenter.exportUrl(diff, "jsonl")}>
                          JSON
                        </a>
                        <Show when={hasRole("qa")}>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => void presenter.remove(diff)}
                          >
                            Delete
                          </Button>
                        </Show>
                      </div>
                    </Cell>
                  </Row>
                )}
              </For>
            </Show>
          </tbody>
        </Table>
      </Loading>
      <CreateDialog presenter={presenter} />
      <DetailDialog presenter={presenter} />
      <RowsDialog presenter={presenter} />
    </div>
  );
}

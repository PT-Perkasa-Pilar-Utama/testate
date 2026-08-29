import type { JSX } from "@solidjs/web";
import { For, Loading, Show } from "solid-js";

import Badge from "@/components/badge.tsx";
import Button from "@/components/button.tsx";
import { Cell, Head, Row, Table } from "@/components/table.tsx";
import { hasRole } from "@/lib/session.ts";
import { CreateDialog, DetailDialog, RowsDialog } from "./diffs.dialogs.view.tsx";
import { changedRows, createDiffsPresenter, targetLabel } from "./diffs.presenter.ts";

const STATUS_VARIANT = { running: "info", ready: "success", failed: "error" } as const;
const LINK = "inline-flex h-8 items-center rounded-lg px-3 text-sm hover:bg-kumo-tint";

export default function DiffsView(props: { slug: string }): JSX.Element {
  const presenter = createDiffsPresenter(() => props.slug);
  return (
    <div class="grid gap-4">
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
              <Head>Changed rows</Head>
              <Head>Expires</Head>
              <Head>Actions</Head>
            </tr>
          </thead>
          <tbody>
            <For each={presenter.value()}>
              {(diff) => (
                <Row>
                  <Cell>{diff.base.name}</Cell>
                  <Cell>{targetLabel(diff.target)}</Cell>
                  <Cell>
                    <Badge variant={STATUS_VARIANT[diff.status]}>{diff.status}</Badge>
                  </Cell>
                  <Cell>{changedRows(diff)}</Cell>
                  <Cell>{diff.expires_at}</Cell>
                  <Cell>
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
          </tbody>
        </Table>
      </Loading>
      <CreateDialog presenter={presenter} />
      <DetailDialog presenter={presenter} />
      <RowsDialog presenter={presenter} />
    </div>
  );
}

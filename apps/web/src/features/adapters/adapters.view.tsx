import type { JSX } from "@solidjs/web";
import { For, Loading } from "solid-js";

import Badge from "@/components/badge.tsx";
import { Cell, Head, Row, Table } from "@/components/table.tsx";
import { href, navigate } from "@/lib/router.ts";
import { createAdaptersPresenter } from "./adapters.presenter.ts";

const STATUS_VARIANT = { ok: "success", error: "error", disabled: "secondary" } as const;

export default function AdaptersView(props: { slug: string }): JSX.Element {
  const presenter = createAdaptersPresenter(() => props.slug);
  const path = (id: string): string => `/projects/${props.slug}/adapters/${id}`;
  return (
    <Loading fallback={<p class="text-kumo-subtle">Loading adapters...</p>}>
      <Table>
        <thead>
          <tr>
            <Head>Name</Head>
            <Head>Engine</Head>
            <Head>Tier</Head>
            <Head>Mode</Head>
            <Head>Status</Head>
          </tr>
        </thead>
        <tbody>
          <For each={presenter.value()}>
            {(adapter) => (
              <Row>
                <Cell>
                  <a
                    class="text-kumo-info hover:underline"
                    href={href(path(adapter.id))}
                    onClick={(event) => {
                      event.preventDefault();
                      navigate(path(adapter.id));
                    }}
                  >
                    {adapter.name}
                  </a>
                </Cell>
                <Cell>
                  {adapter.engine}
                  {adapter.engine_version === null ? "" : ` ${adapter.engine_version}`}
                </Cell>
                <Cell>
                  <Badge variant="outline">{adapter.tier}</Badge>
                </Cell>
                <Cell>
                  <Badge variant={adapter.mode === "read_only" ? "info" : "secondary"}>
                    {adapter.mode}
                  </Badge>
                </Cell>
                <Cell>
                  <Badge variant={STATUS_VARIANT[adapter.status]}>{adapter.status}</Badge>
                </Cell>
              </Row>
            )}
          </For>
        </tbody>
      </Table>
    </Loading>
  );
}

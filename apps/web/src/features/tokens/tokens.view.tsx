import type { JSX } from "@solidjs/web";
import { For, Loading } from "solid-js";

import Badge from "@/components/badge.tsx";
import { Cell, Head, Row, Table } from "@/components/table.tsx";
import { createTokensPresenter } from "./tokens.presenter.ts";

export default function TokensView(): JSX.Element {
  const presenter = createTokensPresenter();
  return (
    <section class="grid gap-6">
      <div class="grid gap-1.5">
        <h2 class="text-lg font-semibold">API tokens</h2>
        <p class="text-kumo-subtle">
          Personal tokens act as their role; agent tokens are viewer-only and reach the MCP endpoint
          alone.
        </p>
      </div>
      <Loading fallback={<p class="text-kumo-subtle">Loading tokens...</p>}>
        <Table>
          <thead>
            <tr>
              <Head>Name</Head>
              <Head>Kind</Head>
              <Head>Role</Head>
              <Head>Prefix</Head>
              <Head>Last used</Head>
              <Head>Expires</Head>
            </tr>
          </thead>
          <tbody>
            <For each={presenter.value()}>
              {(token) => (
                <Row>
                  <Cell>{token.name}</Cell>
                  <Cell>
                    <Badge variant={token.kind === "agent" ? "info" : "outline"}>
                      {token.kind}
                    </Badge>
                  </Cell>
                  <Cell>{token.role}</Cell>
                  <Cell>
                    <code>{token.prefix}</code>
                  </Cell>
                  <Cell>{token.last_used_at ?? "never"}</Cell>
                  <Cell>{token.expires_at ?? "no expiry"}</Cell>
                </Row>
              )}
            </For>
          </tbody>
        </Table>
      </Loading>
    </section>
  );
}

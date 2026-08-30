import type { JSX } from "@solidjs/web";
import PageHeader from "@/components/page-header.tsx";
import { Loading } from "solid-js";

import Badge from "@/components/badge.tsx";
import Button from "@/components/button.tsx";
import LayerCard from "@/components/layer-card.tsx";
import { createHealthPresenter } from "./health.presenter.ts";

export default function HealthView(): JSX.Element {
  const presenter = createHealthPresenter();
  return (
    <section class="grid gap-6">
      <PageHeader title="Health" description="Liveness of this Testate instance." />
      <LayerCard class="px-5 py-4">
        <Loading fallback={<p class="text-kumo-subtle">Checking...</p>}>
          <div class="flex items-center gap-3">
            <Badge variant={presenter.health().status === "ok" ? "success" : "warning"}>
              {presenter.health().status}
            </Badge>
            <Button size="sm" onClick={() => presenter.refresh()}>
              Refresh
            </Button>
          </div>
        </Loading>
      </LayerCard>
    </section>
  );
}

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
      <PageHeader
        title="Health"
        description="Liveness of this Testate instance."
        actions={
          <Button size="sm" variant="secondary" onClick={() => presenter.refresh()}>
            Refresh
          </Button>
        }
      />
      <LayerCard class="px-5 py-4">
        <Loading fallback={<p class="text-kumo-subtle">Checking...</p>}>
          <div class="flex items-center gap-3">
            <Badge variant={presenter.health().status === "ok" ? "success" : "warning"}>
              {presenter.health().status}
            </Badge>
            <span class="text-kumo-subtle">
              {presenter.health().status === "ok"
                ? "Everything this instance depends on answered."
                : "Something it depends on did not answer. An admin sees the breakdown."}
            </span>
          </div>
        </Loading>
      </LayerCard>
    </section>
  );
}

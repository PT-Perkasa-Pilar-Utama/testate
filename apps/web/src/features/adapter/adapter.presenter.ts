import { createSignal } from "solid-js";
import type { Adapter, Entry, Introspection, RestRequest } from "@testate/shared";

import { attempt, showToast } from "@/components/toast.tsx";
import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { navigate } from "@/lib/router.ts";
import { adaptersModel } from "../adapters/adapters.model.ts";
import type { AdapterDeletionPlan } from "../adapters/adapters.model.ts";
import { describeOutcome } from "../adapters/adapters.presenter.ts";
import { adapterModel } from "./adapter.model.ts";

export type AdapterDetail =
  | { view: "tables"; schema: Introspection }
  | { view: "files"; entries: Entry[] }
  | { view: "requests"; requests: RestRequest[] };

export type AdapterPresenter = {
  adapter: Refreshable<Adapter>;
  detail: Refreshable<AdapterDetail>;
  tables: () => Introspection | null;
  entries: () => Entry[] | null;
  requests: () => RestRequest[] | null;
  setMode: (mode: "sandbox" | "read_only") => Promise<void>;
  retest: () => Promise<void>;
  plan: () => AdapterDeletionPlan | null;
  openDelete: () => Promise<void>;
  closeDelete: () => void;
  confirmDelete: () => Promise<void>;
};

/** REST adapters list saved requests; the Files tier lists entries; the rest introspect. */
async function loadDetail(slug: string, adapter: Adapter): Promise<AdapterDetail> {
  if (adapter.kind === "rest") {
    return { view: "requests", requests: await adapterModel.requests(slug, adapter.id) };
  }
  if (adapter.tier === "files") {
    return { view: "files", entries: await adapterModel.entries(slug, adapter.id) };
  }
  return { view: "tables", schema: await adapterModel.schema(slug, adapter.id) };
}

export function createAdapterPresenter(slug: () => string, id: () => string): AdapterPresenter {
  const adapter = createRefreshable(() => adaptersModel.get(slug(), id()));
  const detail = createRefreshable(() => loadDetail(slug(), adapter.value()));
  const [plan, setPlan] = createSignal<AdapterDeletionPlan | null>(null);
  return {
    adapter,
    detail,
    tables: () => {
      const current = detail.value();
      return current.view === "tables" ? current.schema : null;
    },
    entries: () => {
      const current = detail.value();
      return current.view === "files" ? current.entries : null;
    },
    requests: () => {
      const current = detail.value();
      return current.view === "requests" ? current.requests : null;
    },
    setMode: (mode) => {
      const staticSlug = slug();
      const staticId = id();
      return attempt(async () => {
        await adaptersModel.setMode(staticSlug, staticId, mode);
        adapter.refresh();
      });
    },
    retest: () => {
      const staticSlug = slug();
      const staticId = id();
      return attempt(async () => {
        const outcome = await adaptersModel.retest(staticSlug, staticId);
        showToast(describeOutcome(outcome), "success");
        adapter.refresh();
      });
    },
    plan,
    openDelete: () => {
      const staticSlug = slug();
      const staticId = id();
      return attempt(async () => {
        setPlan(await adaptersModel.deletionPlan(staticSlug, staticId));
      });
    },
    closeDelete: () => setPlan(null),
    confirmDelete: () => {
      const staticPlan = plan();
      const staticSlug = slug();
      const staticId = id();
      if (staticPlan === null) return Promise.resolve();
      return attempt(async () => {
        await adaptersModel.remove(staticSlug, staticId, {
          plan_id: staticPlan.plan_id,
          action: staticPlan.adapter.action === "skip" ? "skip" : "restore",
        });
        setPlan(null);
        showToast("Deletion job queued; the database returns to its init state first", "info");
        navigate(`/projects/${staticSlug}`);
      });
    },
  };
}

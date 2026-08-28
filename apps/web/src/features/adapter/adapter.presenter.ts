import type { Adapter, Entry, Introspection, RestRequest } from "@testate/shared";

import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { adaptersModel } from "../adapters/adapters.model.ts";
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
  };
}

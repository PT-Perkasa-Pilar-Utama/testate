import type { Adapter } from "@testate/shared";

import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { adaptersModel } from "./adapters.model.ts";

export type AdaptersPresenter = Refreshable<Adapter[]>;

export function createAdaptersPresenter(slug: () => string): AdaptersPresenter {
  return createRefreshable(() => adaptersModel.list(slug()));
}

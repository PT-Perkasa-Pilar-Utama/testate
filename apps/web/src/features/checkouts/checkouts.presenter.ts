import type { Checkout } from "@testate/shared";

import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { checkoutsModel } from "./checkouts.model.ts";

export type CheckoutsPresenter = Refreshable<Checkout[]>;

export function createCheckoutsPresenter(slug: () => string): CheckoutsPresenter {
  return createRefreshable(() => checkoutsModel.list(slug()));
}

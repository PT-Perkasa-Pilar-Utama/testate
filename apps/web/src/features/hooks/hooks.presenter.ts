import type { Hook } from "@testate/shared";

import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { hooksModel } from "./hooks.model.ts";

export type HooksPresenter = Refreshable<Hook[]>;

export function createHooksPresenter(slug: () => string): HooksPresenter {
  return createRefreshable(() => hooksModel.list(slug()));
}

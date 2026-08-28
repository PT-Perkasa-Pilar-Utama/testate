import type { ApiToken } from "@testate/shared";

import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { tokensModel } from "./tokens.model.ts";

export type TokensPresenter = Refreshable<ApiToken[]>;

export function createTokensPresenter(): TokensPresenter {
  return createRefreshable(() => tokensModel.list());
}

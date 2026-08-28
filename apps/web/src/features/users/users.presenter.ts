import type { User } from "@testate/shared";

import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { usersModel } from "./users.model.ts";

export type UsersPresenter = Refreshable<User[]>;

export function createUsersPresenter(): UsersPresenter {
  return createRefreshable(() => usersModel.list());
}

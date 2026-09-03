import type { ChangePasswordInput } from "@testate/shared";

import { attempt, showToast } from "@/lib/toast.ts";
import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { createPasswordPresenter } from "../auth/auth.presenter.ts";
import type { PasswordPresenter } from "../auth/auth.presenter.ts";
import { accountModel } from "./account.model.ts";
import type { Session } from "./account.model.ts";

export type AccountPresenter = {
  sessions: Refreshable<Session[]>;
  password: PasswordPresenter;
  revoke: (session: Session) => Promise<void>;
  /** Resolves true once the password actually changed, so the view knows whether it may clear
   *  its own form - a refusal leaves the presenter's error for the banner instead. */
  changePassword: (input: ChangePasswordInput) => Promise<boolean>;
};

export function createAccountPresenter(): AccountPresenter {
  const sessions = createRefreshable(() => accountModel.sessions());
  const password = createPasswordPresenter();
  return {
    sessions,
    password,
    revoke: (session) =>
      attempt(async () => {
        await accountModel.revokeSession(session.id);
        sessions.refresh();
      }),
    changePassword: async (input) => {
      await password.submit(input);
      if (password.error() !== null) return false;
      showToast("Password changed. Other sessions were signed out.", "success");
      sessions.refresh();
      return true;
    },
  };
}

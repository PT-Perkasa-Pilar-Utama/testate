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
  changePassword: () => Promise<void>;
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
    changePassword: async () => {
      await password.submit();
      if (password.error() !== null) return;
      password.setCurrent("");
      password.setNext("");
      showToast("Password changed; other sessions were signed out", "success");
      sessions.refresh();
    },
  };
}

import { createSignal } from "solid-js";
import type { CreateUserInput, ResetPasswordInput, User } from "@testate/shared";
import { ROLES } from "@testate/shared";

import { attempt, showToast } from "@/lib/toast.ts";
import { createPaged } from "@/lib/async.ts";
import type { Paged } from "@/lib/async.ts";
import { actor } from "@/lib/session.ts";
import { usersModel } from "./users.model.ts";

export const ROLE_OPTIONS = ROLES.map((role) => ({ value: role, label: role }));

export type UsersPresenter = Paged<User> & {
  creating: () => boolean;
  error: () => string | null;
  openCreate: () => void;
  closeCreate: () => void;
  create: (input: CreateUserInput) => Promise<void>;
  resetting: () => User | null;
  openReset: (user: User) => void;
  closeReset: () => void;
  resetPassword: (input: ResetPasswordInput) => Promise<void>;
  setDisabled: (user: User, disabled: boolean) => Promise<void>;
  /** The account the delete dialog is asking about, null when it is closed. */
  removing: () => User | null;
  askRemove: (user: User) => void;
  cancelRemove: () => void;
  remove: () => Promise<void>;
  isSelf: (user: User) => boolean;
};

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

export function createUsersPresenter(): UsersPresenter {
  const users = createPaged((cursor) => usersModel.page(cursor));
  const [creating, setCreating] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [resetting, setResetting] = createSignal<User | null>(null);
  const [removing, setRemoving] = createSignal<User | null>(null);
  return {
    ...users,
    creating,
    error,
    openCreate: () => setCreating(true),
    closeCreate: () => {
      setCreating(false);
      setError(null);
    },
    create: async (input) => {
      setError(null);
      try {
        await usersModel.create(input);
        setCreating(false);
        users.refresh();
      } catch (cause: unknown) {
        setError(messageOf(cause, "could not create the user"));
      }
    },
    resetting,
    openReset: (user) => setResetting(user),
    closeReset: () => setResetting(null),
    resetPassword: (input) => {
      const staticUser = resetting();
      if (staticUser === null) return Promise.resolve();
      return attempt(async () => {
        await usersModel.resetPassword(staticUser.id, input.temporary_password);
        setResetting(null);
        showToast(`${staticUser.username} must change the password at the next login`, "success");
      });
    },
    setDisabled: (user, disabled) =>
      attempt(async () => {
        await (disabled ? usersModel.disable(user.id) : usersModel.enable(user.id));
        users.refresh();
      }),
    removing,
    askRemove: (user) => setRemoving(user),
    cancelRemove: () => setRemoving(null),
    remove: () => {
      const staticUser = removing();
      setRemoving(null);
      return attempt(async () => {
        if (staticUser === null) return;
        await usersModel.remove(staticUser.id);
        users.refresh();
      });
    },
    isSelf: (user) => actor()?.id === user.id,
  };
}

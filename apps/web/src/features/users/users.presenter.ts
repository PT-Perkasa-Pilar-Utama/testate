import { createSignal } from "solid-js";
import type { Role, User } from "@testate/shared";
import { PASSWORD_MIN_LENGTH, ROLES } from "@testate/shared";

import { attempt, showToast } from "@/components/toast.tsx";
import { createPaged } from "@/lib/async.ts";
import type { Paged } from "@/lib/async.ts";
import { actor } from "@/lib/session.ts";
import { usersModel } from "./users.model.ts";

export const ROLE_OPTIONS = ROLES.map((role) => ({ value: role, label: role }));

export type UserDraft = {
  username: string;
  display_name: string;
  role: Role;
  temporary_password: string;
};

const EMPTY_DRAFT: UserDraft = {
  username: "",
  display_name: "",
  role: "viewer",
  temporary_password: "",
};

export type UsersPresenter = Paged<User> & {
  creating: () => boolean;
  draft: () => UserDraft;
  error: () => string | null;
  openCreate: () => void;
  closeCreate: () => void;
  setDraft: (patch: Partial<UserDraft>) => void;
  create: () => Promise<void>;
  resetting: () => User | null;
  temporaryPassword: () => string;
  openReset: (user: User) => void;
  closeReset: () => void;
  setTemporaryPassword: (value: string) => void;
  resetPassword: () => Promise<void>;
  setDisabled: (user: User, disabled: boolean) => Promise<void>;
  remove: (user: User) => Promise<void>;
  isSelf: (user: User) => boolean;
};

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

export function createUsersPresenter(): UsersPresenter {
  const users = createPaged((cursor) => usersModel.page(cursor));
  const [creating, setCreating] = createSignal(false);
  const [draft, setDraftSignal] = createSignal<UserDraft>(EMPTY_DRAFT);
  const [error, setError] = createSignal<string | null>(null);
  const [resetting, setResetting] = createSignal<User | null>(null);
  const [temporaryPassword, setTemporaryPassword] = createSignal("");
  return {
    ...users,
    creating,
    draft,
    error,
    openCreate: () => setCreating(true),
    closeCreate: () => {
      setCreating(false);
      setError(null);
    },
    setDraft: (patch) => setDraftSignal((current) => ({ ...current, ...patch })),
    create: async () => {
      const input = draft();
      if (input.temporary_password.length < PASSWORD_MIN_LENGTH) {
        setError(`temporary password needs at least ${PASSWORD_MIN_LENGTH} characters`);
        return;
      }
      setError(null);
      try {
        await usersModel.create({ ...input, username: input.username.trim().toLowerCase() });
        setCreating(false);
        setDraftSignal(EMPTY_DRAFT);
        users.refresh();
      } catch (cause: unknown) {
        setError(messageOf(cause, "could not create the user"));
      }
    },
    resetting,
    temporaryPassword,
    openReset: (user) => {
      setTemporaryPassword("");
      setResetting(user);
    },
    closeReset: () => setResetting(null),
    setTemporaryPassword,
    resetPassword: () => {
      const staticUser = resetting();
      const staticPassword = temporaryPassword();
      if (staticUser === null) return Promise.resolve();
      return attempt(async () => {
        await usersModel.resetPassword(staticUser.id, staticPassword);
        setResetting(null);
        showToast(`${staticUser.username} must change the password at the next login`, "success");
      });
    },
    setDisabled: (user, disabled) =>
      attempt(async () => {
        await (disabled ? usersModel.disable(user.id) : usersModel.enable(user.id));
        users.refresh();
      }),
    remove: (user) =>
      attempt(async () => {
        if (!window.confirm(`Delete ${user.username}? Audit rows keep the name.`)) return;
        await usersModel.remove(user.id);
        users.refresh();
      }),
    isSelf: (user) => actor()?.id === user.id,
  };
}

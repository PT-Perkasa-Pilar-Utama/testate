import { createSignal } from "solid-js";
import type {
  CreateUserInput,
  EditUserInput,
  ResetPasswordInput,
  Role,
  User,
} from "@testate/shared";

import { humanMessage } from "@/lib/api-error.ts";
import { attempt, showToast } from "@/lib/toast.ts";
import { createPaged } from "@/lib/async.ts";
import type { Paged } from "@/lib/async.ts";
import { createTableControls } from "@/lib/table.ts";
import type { TableView } from "@/lib/table.ts";
import { actor } from "@/lib/session.ts";
import { usersModel } from "./users.model.ts";

export type UserSort = "username" | "display_name" | "role" | "last_login_at";

export type UsersPresenter = Paged<User> & {
  /** Sort and search, performed by the API over every account rather than the page on screen. */
  table: TableView<User, UserSort>;
  /** The role narrowing; "" means every role. */
  role: () => Role | "";
  setRole: (role: Role | "") => void;
  creating: () => boolean;
  error: () => string | null;
  openCreate: () => void;
  closeCreate: () => void;
  create: (input: CreateUserInput) => Promise<void>;
  /** The account the edit dialog is changing, null when it is closed. */
  editing: () => User | null;
  openEdit: (user: User) => void;
  closeEdit: () => void;
  update: (input: EditUserInput) => Promise<void>;
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
  return humanMessage(cause, fallback);
}

export function createUsersPresenter(): UsersPresenter {
  const controls = createTableControls<UserSort>();
  const [role, setRole] = createSignal<Role | "">("");
  const users = createPaged(
    (cursor) => usersModel.page(cursor, controls.params(), role()),
    // The role narrows the same list the sort and search do, so a change to it has to drop the
    // pages already appended the way a new sort or search does (`createPaged`'s own doc comment).
    () => `${controls.key()}|${role()}`
  );
  const table: TableView<User, UserSort> = { ...controls, rows: users.value };
  const [creating, setCreating] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [editing, setEditing] = createSignal<User | null>(null);
  const [resetting, setResetting] = createSignal<User | null>(null);
  const [removing, setRemoving] = createSignal<User | null>(null);
  return {
    ...users,
    table,
    role,
    setRole,
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
    editing,
    openEdit: (user) => {
      setError(null);
      setEditing(user);
    },
    closeEdit: () => {
      setEditing(null);
      setError(null);
    },
    update: async (input) => {
      const staticUser = editing();
      if (staticUser === null) return;
      setError(null);
      try {
        await usersModel.update(staticUser.id, { ...input });
        setEditing(null);
        users.refresh();
      } catch (cause: unknown) {
        // The last enabled admin cannot be demoted, and the server is the only thing that knows
        // whether this is the last one, so that refusal arrives here rather than from the schema.
        setError(messageOf(cause, "could not update the user"));
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

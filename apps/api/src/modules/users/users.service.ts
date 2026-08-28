import type { Actor, User } from "@testate/shared";

import type { RequestMeta } from "../../lib/http/auth.ts";
import { conflict, notFound } from "../../lib/http/index.ts";
import type { PasswordHasher } from "../../lib/password/index.ts";
import type { AuditService } from "../audit/audit.service.ts";
import { toUser } from "./users.repository.ts";
import type { UserRecord, UsersListQuery, UsersRepository } from "./users.repository.ts";

export type CreateUserInput = {
  username: string;
  display_name: string;
  role: User["role"];
  temporary_password: string;
};

export type UpdateUserInput = { display_name?: string; role?: User["role"] };

export type UsersService = {
  list(query: UsersListQuery): Promise<User[]>;
  create(actor: Actor, input: CreateUserInput, meta: RequestMeta): Promise<User>;
  get(id: string): Promise<User>;
  update(actor: Actor, id: string, patch: UpdateUserInput, meta: RequestMeta): Promise<User>;
  setDisabled(actor: Actor, id: string, disabled: boolean, meta: RequestMeta): Promise<User>;
  remove(actor: Actor, id: string, meta: RequestMeta): Promise<void>;
  resetPassword(
    actor: Actor,
    id: string,
    temporaryPassword: string,
    meta: RequestMeta
  ): Promise<void>;
  /** Creates the first admin from the environment when `users` is empty (22 §22.2 step 7). */
  bootstrap(username: string, password: string): Promise<boolean>;
};

export type UsersDeps = {
  repo: UsersRepository;
  sessions: { revokeAll(userId: string): number };
  audit: AuditService;
  password: PasswordHasher;
  now: () => Date;
};

export function createUsersService(deps: UsersDeps): UsersService {
  const { repo, audit } = deps;
  const nowIso = (): string => deps.now().toISOString();
  const find = (id: string): UserRecord => {
    const user = repo.byId(id);
    if (user === null) throw notFound("user");
    return user;
  };
  const refreshed = (id: string): User => toUser(find(id));
  /** An enabled admin is the last one when no other enabled admin exists (03 §3.4). */
  const isLastEnabledAdmin = (user: UserRecord): boolean =>
    user.role === "admin" && user.disabled_at === null && repo.countEnabledAdmins() === 1;
  const record = (
    actor: Actor | null,
    action: string,
    user: UserRecord,
    meta: RequestMeta | undefined,
    details: Record<string, string | boolean> = {}
  ): void => {
    audit.record(
      meta === undefined
        ? { actor, action, target_type: "user", target_id: user.id, details, outcome: "succeeded" }
        : {
            actor,
            action,
            target_type: "user",
            target_id: user.id,
            details,
            outcome: "succeeded",
            meta,
          }
    );
  };

  return {
    async list(query) {
      return repo.list(query).map(toUser);
    },
    async create(actor, input, meta) {
      if (repo.byUsername(input.username) !== null) {
        throw conflict("username is taken", { username: input.username });
      }
      const user = repo.insert({
        id: Bun.randomUUIDv7(),
        username: input.username,
        display_name: input.display_name,
        role: input.role,
        password_hash: await deps.password.hash(input.temporary_password),
        must_change_password: true,
        created_at: nowIso(),
      });
      record(actor, "user.created", user, meta, { username: user.username, role: user.role });
      return toUser(user);
    },
    async get(id) {
      return refreshed(id);
    },
    async update(actor, id, patch, meta) {
      const user = find(id);
      const demotes = patch.role !== undefined && patch.role !== "admin";
      if (demotes && isLastEnabledAdmin(user))
        throw conflict("cannot demote the last enabled admin");
      repo.setProfile(id, patch.display_name, patch.role, nowIso());
      record(actor, "user.updated", user, meta, { role: patch.role ?? user.role });
      return refreshed(id);
    },
    async setDisabled(actor, id, disabled, meta) {
      const user = find(id);
      if (disabled && isLastEnabledAdmin(user))
        throw conflict("cannot disable the last enabled admin");
      repo.setDisabled(id, disabled ? nowIso() : null, nowIso());
      if (disabled) deps.sessions.revokeAll(id);
      record(actor, disabled ? "user.disabled" : "user.updated", user, meta, { disabled });
      return refreshed(id);
    },
    async remove(actor, id, meta) {
      const user = find(id);
      if (actor.kind === "user" && actor.id === id)
        throw conflict("cannot delete your own account");
      if (isLastEnabledAdmin(user)) throw conflict("cannot delete the last enabled admin");
      deps.sessions.revokeAll(id);
      repo.remove(id);
      record(actor, "user.deleted", user, meta, { username: user.username });
    },
    async resetPassword(actor, id, temporaryPassword, meta) {
      const user = find(id);
      repo.setPassword(id, await deps.password.hash(temporaryPassword), true, nowIso());
      deps.sessions.revokeAll(id);
      record(actor, "user.password_reset", user, meta);
    },
    async bootstrap(username, password) {
      if (repo.count() > 0) return false;
      const user = repo.insert({
        id: Bun.randomUUIDv7(),
        username,
        display_name: username,
        role: "admin",
        password_hash: await deps.password.hash(password),
        must_change_password: true,
        created_at: nowIso(),
      });
      record(null, "user.created", user, undefined, { username, role: "admin", bootstrap: true });
      return true;
    },
  };
}

import type { User } from "@testate/shared";

import { notFound } from "../../lib/http/index.ts";
import { USER_MOCK } from "./users.mock.ts";

export type UsersService = {
  list(): Promise<User[]>;
  create(): Promise<User>;
  get(id: string): Promise<User>;
  update(id: string): Promise<User>;
  setDisabled(id: string, disabled: boolean): Promise<User>;
  remove(id: string): Promise<void>;
  resetPassword(id: string): Promise<void>;
};

/** SCAFFOLD: returns the mock user; the users card wires the repository (06 §6.3). */
export function createUsersService(): UsersService {
  const find = (id: string): User => {
    if (id !== USER_MOCK.id) throw notFound("user");
    return USER_MOCK;
  };
  return {
    async list() {
      return [USER_MOCK];
    },
    async create() {
      return USER_MOCK;
    },
    async get(id) {
      return find(id);
    },
    async update(id) {
      return find(id);
    },
    async setDisabled(id, disabled) {
      return { ...find(id), disabled_at: disabled ? "2026-08-28T09:00:00.000Z" : null };
    },
    async remove(id) {
      find(id);
    },
    async resetPassword(id) {
      find(id);
    },
  };
}

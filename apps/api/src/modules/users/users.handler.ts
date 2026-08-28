import { createUserSchema, resetPasswordSchema, updateUserSchema } from "@testate/shared";

import { ok, okPage, param, parseBody } from "../../lib/http/index.ts";
import type { Handler } from "../../lib/http/index.ts";
import type { UsersService } from "./users.service.ts";

export type UsersHandlers = {
  list: Handler;
  create: Handler;
  get: Handler;
  update: Handler;
  disable: Handler;
  enable: Handler;
  remove: Handler;
  resetPassword: Handler;
};

export function createUsersHandlers(service: UsersService): UsersHandlers {
  return {
    list: async (c) => okPage(c, await service.list(), null, 50),
    create: async (c) => {
      await parseBody(c, createUserSchema);
      return ok(c, await service.create(), 201);
    },
    get: async (c) => ok(c, await service.get(param(c, "id"))),
    update: async (c) => {
      await parseBody(c, updateUserSchema);
      return ok(c, await service.update(param(c, "id")));
    },
    disable: async (c) => ok(c, await service.setDisabled(param(c, "id"), true)),
    enable: async (c) => ok(c, await service.setDisabled(param(c, "id"), false)),
    remove: async (c) => {
      await service.remove(param(c, "id"));
      return c.body(null, 204);
    },
    resetPassword: async (c) => {
      await parseBody(c, resetPasswordSchema);
      await service.resetPassword(param(c, "id"));
      return c.body(null, 204);
    },
  };
}

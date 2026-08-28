import {
  createUserSchema,
  resetPasswordSchema,
  roleSchema,
  updateUserSchema,
} from "@testate/shared";
import * as v from "valibot";

import { currentActor, requestMeta } from "../../lib/http/auth.ts";
import { firstQuery } from "../../lib/http/query.ts";
import { ok, okPage, param, parseBody, parseQuery } from "../../lib/http/index.ts";
import type { Handler } from "../../lib/http/index.ts";
import type { UsersListQuery } from "./users.repository.ts";
import type { UpdateUserInput, UsersService } from "./users.service.ts";

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

const listQuery = v.object({
  limit: v.optional(
    v.array(v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(1), v.maxValue(200)))
  ),
  sort: v.optional(v.array(v.picklist(["username", "created_at", "last_login_at"]))),
  order: v.optional(v.array(v.picklist(["asc", "desc"]))),
  role: v.optional(v.array(roleSchema)),
  disabled: v.optional(v.array(v.picklist(["true", "false"]))),
  q: v.optional(v.array(v.string())),
});

export function toListQuery(parsed: v.InferOutput<typeof listQuery>): UsersListQuery {
  const query: UsersListQuery = {
    limit: firstQuery(parsed.limit) ?? 50,
    sort: firstQuery(parsed.sort) ?? "username",
    order: firstQuery(parsed.order) ?? "asc",
  };
  const role = firstQuery(parsed.role);
  if (role !== undefined) query.role = role;
  const disabled = firstQuery(parsed.disabled);
  if (disabled !== undefined) query.disabled = disabled === "true";
  const q = firstQuery(parsed.q);
  if (q !== undefined) query.q = q;
  return query;
}

/** Drops undefined optional fields so the patch matches exactOptionalPropertyTypes. */
function toUpdateInput(parsed: v.InferOutput<typeof updateUserSchema>): UpdateUserInput {
  const patch: UpdateUserInput = {};
  if (parsed.display_name !== undefined) patch.display_name = parsed.display_name;
  if (parsed.role !== undefined) patch.role = parsed.role;
  return patch;
}

export function createUsersHandlers(service: UsersService, trustProxy: boolean): UsersHandlers {
  return {
    list: async (c) => {
      const query = toListQuery(parseQuery(c, listQuery));
      return okPage(c, await service.list(query), null, query.limit);
    },
    create: async (c) => {
      const input = await parseBody(c, createUserSchema);
      const user = await service.create(currentActor(c), input, requestMeta(c, trustProxy));
      return ok(c, user, 201);
    },
    get: async (c) => ok(c, await service.get(param(c, "id"))),
    update: async (c) => {
      const patch = toUpdateInput(await parseBody(c, updateUserSchema));
      return ok(
        c,
        await service.update(currentActor(c), param(c, "id"), patch, requestMeta(c, trustProxy))
      );
    },
    disable: async (c) =>
      ok(
        c,
        await service.setDisabled(currentActor(c), param(c, "id"), true, requestMeta(c, trustProxy))
      ),
    enable: async (c) =>
      ok(
        c,
        await service.setDisabled(
          currentActor(c),
          param(c, "id"),
          false,
          requestMeta(c, trustProxy)
        )
      ),
    remove: async (c) => {
      await service.remove(currentActor(c), param(c, "id"), requestMeta(c, trustProxy));
      return c.body(null, 204);
    },
    resetPassword: async (c) => {
      const input = await parseBody(c, resetPasswordSchema);
      await service.resetPassword(
        currentActor(c),
        param(c, "id"),
        input.temporary_password,
        requestMeta(c, trustProxy)
      );
      return c.body(null, 204);
    },
  };
}

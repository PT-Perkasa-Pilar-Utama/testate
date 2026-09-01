import * as v from "valibot";
import type { JsonObject, Role, User } from "@testate/shared";
import { userSchema } from "@testate/shared";

import { apiClient } from "@/lib/api-client.ts";
import type { Page } from "@/lib/async.ts";
import { tableQuery } from "@/lib/table.ts";
import type { TableParams } from "@/lib/table.ts";
import type { UserSort } from "./users.presenter.ts";

const path = (id: string): string => `/users/${encodeURIComponent(id)}`;

export const usersModel = {
  list: (): Promise<User[]> => apiClient.get("/users", { schema: v.array(userSchema) }),
  page: (
    cursor: string | undefined,
    params: TableParams<UserSort>,
    role: Role | ""
  ): Promise<Page<User>> =>
    apiClient.page("/users", userSchema, {
      ...tableQuery(params, cursor),
      role: role === "" ? undefined : role,
    }),
  create: (body: JsonObject): Promise<User> =>
    apiClient.post("/users", { schema: userSchema, body }),
  update: (id: string, body: JsonObject): Promise<User> =>
    apiClient.patch(path(id), { schema: userSchema, body }),
  disable: (id: string): Promise<User> =>
    apiClient.post(`${path(id)}/disable`, { schema: userSchema }),
  enable: (id: string): Promise<User> =>
    apiClient.post(`${path(id)}/enable`, { schema: userSchema }),
  remove: (id: string): Promise<undefined> => apiClient.delete(path(id), { schema: v.undefined() }),
  resetPassword: (id: string, temporary_password: string): Promise<undefined> =>
    apiClient.post(`${path(id)}/reset-password`, {
      schema: v.undefined(),
      body: { temporary_password },
    }),
};

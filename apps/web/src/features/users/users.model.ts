import * as v from "valibot";
import type { JsonObject, User } from "@testate/shared";
import { userSchema } from "@testate/shared";

import { apiClient } from "@/lib/api-client.ts";

const path = (id: string): string => `/users/${encodeURIComponent(id)}`;

export const usersModel = {
  list: (): Promise<User[]> => apiClient.get("/users", { schema: v.array(userSchema) }),
  page: (cursor?: string): Promise<{ data: User[]; next: string | null }> =>
    apiClient.page("/users", userSchema, cursor === undefined ? undefined : { cursor }),
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

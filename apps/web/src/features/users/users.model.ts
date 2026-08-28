import * as v from "valibot";
import type { User } from "@testate/shared";
import { userSchema } from "@testate/shared";

import { apiClient } from "@/lib/api-client.ts";

export const usersModel = {
  list: (): Promise<User[]> => apiClient.get("/users", { schema: v.array(userSchema) }),
};

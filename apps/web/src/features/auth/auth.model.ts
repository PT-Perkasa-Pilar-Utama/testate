import * as v from "valibot";
import type { ChangePasswordInput, LoginInput, LoginResponse } from "@testate/shared";
import { loginResponseSchema } from "@testate/shared";

import { apiClient } from "@/lib/api-client.ts";

export const authModel = {
  login: (body: LoginInput): Promise<LoginResponse> =>
    apiClient.post("/auth/login", { schema: loginResponseSchema, body }),
  logout: (): Promise<undefined> => apiClient.post("/auth/logout", { schema: v.undefined() }),
  changePassword: (body: ChangePasswordInput): Promise<undefined> =>
    apiClient.post("/auth/password", { schema: v.undefined(), body }),
};

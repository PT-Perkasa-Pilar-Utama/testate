import * as v from "valibot";
import { sessionSchema } from "@testate/shared";

import { apiClient } from "@/lib/api-client.ts";

export type Session = v.InferOutput<typeof sessionSchema>;

export const accountModel = {
  sessions: (): Promise<Session[]> =>
    apiClient.get("/auth/sessions", { schema: v.array(sessionSchema) }),
  revokeSession: (id: string): Promise<undefined> =>
    apiClient.delete(`/auth/sessions/${encodeURIComponent(id)}`, { schema: v.undefined() }),
};

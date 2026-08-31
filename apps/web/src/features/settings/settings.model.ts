import type { HealthAdmin, Job, JsonObject, Settings } from "@testate/shared";
import {
  healthAdminSchema,
  jobSchema,
  settingsPatchResultSchema,
  settingsSchema,
} from "@testate/shared";
import type * as v from "valibot";

import { apiClient } from "@/lib/api-client.ts";

export type SettingsPatchResult = v.InferOutput<typeof settingsPatchResultSchema>;

export const settingsModel = {
  get: (): Promise<Settings> => apiClient.get("/settings", { schema: settingsSchema }),
  health: (): Promise<HealthAdmin> => apiClient.get("/health", { schema: healthAdminSchema }),
  update: (body: JsonObject): Promise<SettingsPatchResult> =>
    apiClient.patch("/settings", { schema: settingsPatchResultSchema, body }),
  migrate: (body: JsonObject): Promise<Job> =>
    apiClient.post("/settings/store-migration", { schema: jobSchema, body }),
  backup: (body: JsonObject): Promise<Job> =>
    apiClient.post("/settings/backup", { schema: jobSchema, body }),
  backupUrl: (jobId: string): string =>
    apiClient.url(`/settings/backups/${encodeURIComponent(jobId)}`),
};

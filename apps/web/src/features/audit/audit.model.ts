import * as v from "valibot";
import type { AuditRow } from "@testate/shared";
import { auditRowSchema } from "@testate/shared";

import { apiClient } from "@/lib/api-client.ts";

export const auditModel = {
  list: (): Promise<AuditRow[]> =>
    apiClient.get("/audit-logs", { schema: v.array(auditRowSchema) }),
};

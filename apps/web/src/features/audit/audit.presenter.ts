import type { AuditRow } from "@testate/shared";

import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { auditModel } from "./audit.model.ts";

export type AuditPresenter = Refreshable<AuditRow[]>;

export function createAuditPresenter(): AuditPresenter {
  return createRefreshable(() => auditModel.list());
}

import type { MiddlewareHandler } from "hono";

import type { MetadataDb } from "../../lib/db/index.ts";
import { captureAuditPayloads } from "./audit.capture.ts";
import { createPayloadStore } from "./audit.payloads.ts";
import type { PayloadStore } from "./audit.payloads.ts";
import { createAuditRepository } from "./audit.repository.ts";
import { createAuditService } from "./audit.service.ts";
import type { AuditService } from "./audit.service.ts";

export type AuditModule = {
  audit: AuditService;
  payloads: PayloadStore;
  /** Installed right after the logger, so every request has its id before anything records. */
  captureAudit: MiddlewareHandler;
};

/** Wiring only: the rows, the bodies behind them, and the middleware that keeps the bodies. */
export function createAuditModule(db: MetadataDb, now: () => Date): AuditModule {
  const payloads = createPayloadStore(db);
  return {
    audit: createAuditService({ repo: createAuditRepository(db), payloads, now }),
    payloads,
    captureAudit: captureAuditPayloads(payloads, now),
  };
}

import { Hono } from "hono";
import { checkoutSchema, countersSchema, preflightSchema } from "@testate/shared";
import * as v from "valibot";

import { requireRole } from "../../lib/http/auth.ts";
import { describe } from "../../lib/openapi.ts";
import type { CheckoutsHandlers } from "./checkouts.handler.ts";

const P = "/projects/:slug/checkouts";

export function createCheckoutsRouter(h: CheckoutsHandlers): Hono {
  const router = new Hono();
  router.post(
    `${P}/preflight`,
    requireRole("qa"),
    describe("checkouts", "Preflight a checkout", preflightSchema),
    h.preflight
  );
  router.post(
    P,
    requireRole("qa"),
    describe("checkouts", "Check out a state (job)", v.unknown(), 202),
    h.create
  );
  router.get(
    P,
    requireRole("viewer"),
    describe("checkouts", "Checkout history", v.array(checkoutSchema)),
    h.list
  );
  router.get(
    `${P}/:id`,
    requireRole("viewer"),
    describe("checkouts", "Checkout detail", checkoutSchema),
    h.get
  );
  router.post(
    `${P}/:id/retry`,
    requireRole("qa"),
    describe("checkouts", "Retry failed adapters (job)", v.unknown(), 202),
    h.retry
  );
  router.post(
    `${P}/:id/terminate-blockers`,
    requireRole("qa"),
    describe("checkouts", "Terminate blocking sessions", v.unknown()),
    h.terminateBlockers
  );
  router.get(
    `${P}/:id/counters`,
    requireRole("viewer"),
    describe("checkouts", "Counters step", countersSchema),
    h.counters
  );
  router.post(
    `${P}/:id/repair-counters`,
    requireRole("qa"),
    describe("checkouts", "Repair counters", countersSchema),
    h.repairCounters
  );
  return router;
}

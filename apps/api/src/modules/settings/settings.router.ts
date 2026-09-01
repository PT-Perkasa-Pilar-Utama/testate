import { Hono } from "hono";
import { jobSchema, settingsPatchResultSchema, settingsSchema } from "@testate/shared";
import * as v from "valibot";

import { requireRole, requireUnscoped } from "../../lib/http/auth.ts";
import { describe } from "../../lib/openapi.ts";
import type { SettingsHandlers } from "./settings.handler.ts";

export function createSettingsRouter(h: SettingsHandlers): Hono {
  const router = new Hono();
  router.use("/settings", requireRole("admin"), requireUnscoped());
  router.use("/settings/*", requireRole("admin"), requireUnscoped());
  router.get("/settings", describe("settings", "Read settings", settingsSchema), h.get);
  router.patch(
    "/settings",
    describe("settings", "Update settings", settingsPatchResultSchema),
    h.update
  );
  router.post(
    "/settings/store-migration",
    describe("settings", "Migrate the snapshot store (job)", jobSchema, 202),
    h.migrateStore
  );
  router.post(
    "/settings/backup",
    describe("settings", "Back up Testate (job)", jobSchema, 202),
    h.backup
  );
  router.get(
    "/settings/backups/:job_id",
    describe("settings", "Download a backup", v.unknown()),
    h.downloadBackup
  );
  return router;
}

import { backupRequestSchema, storeMigrationSchema, updateSettingsSchema } from "@testate/shared";

import { currentActor, requestMeta } from "../../lib/http/auth.ts";
import { accepted, ok, param, parseBody } from "../../lib/http/index.ts";
import type { Handler } from "../../lib/http/index.ts";
import type { SettingsService } from "./settings.service.ts";

export type SettingsHandlers = {
  get: Handler;
  update: Handler;
  migrateStore: Handler;
  backup: Handler;
  downloadBackup: Handler;
};

export function createSettingsHandlers(
  service: SettingsService,
  apiPrefix: string,
  trustProxy: boolean
): SettingsHandlers {
  return {
    get: async (c) => ok(c, await service.get()),
    update: async (c) => {
      const patch = await parseBody(c, updateSettingsSchema);
      return ok(c, await service.update(currentActor(c), patch, requestMeta(c, trustProxy)));
    },
    migrateStore: async (c) => {
      const body = await parseBody(c, storeMigrationSchema);
      const job = await service.migrateStore(
        currentActor(c),
        body.target,
        requestMeta(c, trustProxy)
      );
      return accepted(c, job, apiPrefix);
    },
    backup: async (c) => {
      const body = await parseBody(c, backupRequestSchema);
      const job = await service.backup(currentActor(c), body, requestMeta(c, trustProxy));
      return accepted(c, job, apiPrefix);
    },
    downloadBackup: async (c) => {
      const file = await service.backupFile(param(c, "job_id"));
      c.header("Content-Type", "application/x-tar");
      c.header("Content-Length", String(file.size));
      c.header(
        "Content-Disposition",
        `attachment; filename="testate-backup-${param(c, "job_id")}.tar"`
      );
      return c.body(file.stream, 200);
    },
  };
}

import {
  backupRequestSchema,
  jsonObjectSchema,
  storeMigrationSchema,
  updateSettingsSchema,
} from "@testate/shared";
import type { JsonObject, JsonValue } from "@testate/shared";
import * as v from "valibot";

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

function isObject(value: JsonValue): value is JsonObject {
  return (
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}

/** Dotted keys of every leaf in a settings patch, for the environment-lock check. */
export function patchedKeys(patch: JsonObject, prefix = ""): string[] {
  return Object.entries(patch).flatMap(([key, value]) => {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    return isObject(value) ? patchedKeys(value, path) : [path];
  });
}

export function createSettingsHandlers(
  service: SettingsService,
  apiPrefix: string
): SettingsHandlers {
  return {
    get: async (c) => ok(c, await service.get()),
    update: async (c) => {
      const patch = await parseBody(c, updateSettingsSchema);
      return ok(c, await service.update(patchedKeys(v.parse(jsonObjectSchema, patch))));
    },
    migrateStore: async (c) => {
      await parseBody(c, storeMigrationSchema);
      return accepted(c, await service.migrateStore(false), apiPrefix);
    },
    backup: async (c) => {
      await parseBody(c, backupRequestSchema);
      return accepted(c, await service.backup(), apiPrefix);
    },
    downloadBackup: async (c) => {
      c.header("Content-Type", "application/x-tar");
      c.header(
        "Content-Disposition",
        `attachment; filename="testate-backup-${param(c, "job_id")}.tar"`
      );
      return c.body("", 200);
    },
  };
}

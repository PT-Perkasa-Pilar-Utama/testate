/**
 * Boot helpers the composition root calls in order (22 §22.2). Wiring only; each step's rule
 * lives in the library or module it calls.
 */
import { networkInterfaces } from "node:os";

import { ConfigError } from "./lib/config/index.ts";
import type { Config } from "./lib/config/index.ts";
import type { MetadataDb } from "./lib/db/index.ts";
import { SealedConfigError } from "./lib/sealed/index.ts";
import type { KeyRing } from "./lib/sealed/index.ts";
import { banner, disableUnreadableOwners, sweep } from "./lib/sealed/registry.ts";
import type { Unreadable } from "./lib/sealed/registry.ts";
import type { UsersService } from "./modules/users/users.service.ts";

const RULE = "=".repeat(72);

export type SealedBoot = { reSealed: number; unreadable: Unreadable[]; banner: string | null };

export type Bootstrap = { bootstrapped: boolean; bootstrap: (() => Promise<boolean>) | null };

/** Every address this process listens on, so an adapter cannot point Testate at itself (18 §18.1). */
export function ownAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .flatMap((iface) => (iface === undefined ? [] : [iface.address]));
}

/** Step 5: re-seal under the active key; refuse or declare loss per 17 §17.5–17.6. */
export async function sweepSealed(
  ring: KeyRing,
  db: MetadataDb,
  config: Config
): Promise<SealedBoot> {
  const report = await sweep(ring, db);
  const framed = banner(report, ring);
  if (framed !== null) process.stderr.write(`${RULE}\n${framed}\n${RULE}\n`);
  if (report.unreadable.length > 0) {
    if (!config.TESTATE_SECRETS_ACCEPT_UNREADABLE) {
      const total = report.unreadable.length + report.reSealed + report.skipped;
      throw new SealedConfigError(
        `${report.unreadable.length} of ${total} stored sealed values open with no configured key; append the sealing key or set TESTATE_SECRETS_ACCEPT_UNREADABLE=true`
      );
    }
    disableUnreadableOwners(db, report, new Date().toISOString());
    for (const item of report.unreadable) {
      process.stderr.write(
        `unreadable sealed value: ${item.table}.${item.column} row ${item.rowId} (key ${item.kid})\n`
      );
    }
  }
  return { reSealed: report.reSealed, unreadable: report.unreadable, banner: framed };
}

/** Step 7: the first admin comes from the environment while `users` is empty. */
export async function bootstrapAdmin(
  userCount: number,
  users: UsersService,
  config: Config
): Promise<Bootstrap> {
  const password = config.TESTATE_ADMIN_PASSWORD;
  if (password === undefined) {
    if (userCount > 0) return { bootstrapped: false, bootstrap: null };
    throw new ConfigError([
      { variable: "TESTATE_ADMIN_PASSWORD", message: "required while the users table is empty" },
    ]);
  }
  const bootstrap = (): Promise<boolean> => users.bootstrap(config.TESTATE_ADMIN_USER, password);
  return { bootstrapped: userCount === 0 ? await bootstrap() : false, bootstrap };
}

/** Boot refusals print a framed message and exit 78 (configuration error), per 22 §22.2. */
export function refuse(cause: unknown): never {
  if (!(cause instanceof ConfigError) && !(cause instanceof SealedConfigError)) throw cause;
  process.stderr.write(`${RULE}\nTestate refused to start\n${cause.message}\n${RULE}\n`);
  process.exit(78);
}

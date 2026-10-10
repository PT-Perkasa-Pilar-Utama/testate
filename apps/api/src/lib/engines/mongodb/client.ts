import { MongoClient } from "mongodb";
import * as v from "valibot";
import type { Db } from "mongodb";

import { sha256 } from "../../password/index.ts";
import { EngineError } from "../types.ts";
import type { ConnectionRef, MongodbConfig } from "../types.ts";
import type { Netguard } from "../postgres/pool.ts";

const CONNECT_TIMEOUT_MS = 10000;

export type MongoHandle = { client: MongoClient; db: Db };

/** A client on loan: give it back with `release`, once, when the operation is over. */
export type MongoLease = { handle: MongoHandle; release: () => Promise<void> };

export type MongoClientManager = {
  acquire(ref: ConnectionRef): Promise<MongoLease>;
  /**
   * Retires the cached client: the next operation opens a fresh one, and the retired one closes
   * once the operations already holding it have released it. Closing it at once cut a browse or a
   * query off mid-command whenever a checkout or a snapshot of the same adapter ended beside it.
   */
  evict(connectionId: string): Promise<void>;
};

type Entry = { handle: MongoHandle; key: string; users: number; retired: boolean };

function keyOf(config: MongodbConfig): string {
  return sha256(
    `${config.host}|${config.port}|${config.database}|${config.user}|${config.password}|${config.ssl}|${config.authSource}`
  );
}

/** Opens a client against one checked address; the URL never carries the host name (18 §18.3). */
export async function connect(config: MongodbConfig, netguard: Netguard): Promise<MongoHandle> {
  const verdict = await netguard.check({
    host: config.host,
    port: config.port,
    purpose: "database",
  });
  if (!verdict.allowed) {
    throw new EngineError(
      "unreachable",
      `${config.host}:${config.port} is blocked (${verdict.reason})`,
      { reason: verdict.reason }
    );
  }
  const address = verdict.addresses[0] ?? config.host;
  const client = new MongoClient(`mongodb://${address}:${config.port}/${config.database}`, {
    auth: { username: config.user, password: config.password },
    authSource: config.authSource,
    tls: config.ssl === "require",
    directConnection: true,
    connectTimeoutMS: CONNECT_TIMEOUT_MS,
    serverSelectionTimeoutMS: CONNECT_TIMEOUT_MS,
    maxPoolSize: 4,
  });
  await client.connect();
  return { client, db: client.db(config.database) };
}

export function createMongoClientManager(netguard: Netguard): MongoClientManager {
  const clients = new Map<string, Entry>();
  const closeIfIdle = async (entry: Entry): Promise<void> => {
    if (entry.retired && entry.users === 0) await entry.handle.client.close();
  };
  const retire = async (connectionId: string): Promise<void> => {
    const entry = clients.get(connectionId);
    if (entry === undefined) return;
    clients.delete(connectionId);
    entry.retired = true;
    await closeIfIdle(entry);
  };
  return {
    async acquire(ref) {
      if (ref.config.engine !== "mongodb")
        throw new EngineError("unsupported", `${ref.config.engine} config on the mongodb engine`);
      const key = keyOf(ref.config);
      if (clients.get(ref.connectionId)?.key !== key) await retire(ref.connectionId);
      let entry = clients.get(ref.connectionId);
      if (entry === undefined) {
        entry = { handle: await connect(ref.config, netguard), key, users: 0, retired: false };
        clients.set(ref.connectionId, entry);
      }
      const held = entry;
      held.users += 1;
      let released = false;
      return {
        handle: held.handle,
        release: async () => {
          if (released) return;
          released = true;
          held.users -= 1;
          await closeIfIdle(held);
        },
      };
    },
    evict: retire,
  };
}

const driverError = v.object({ code: v.optional(v.union([v.number(), v.string()])) });

/** Server error codes and message patterns that map to an engine error kind (12 §12.1). */
const KINDS: [RegExp, number[], EngineError["kind"], boolean][] = [
  [/Authentication failed/i, [18], "auth_failed", false],
  [/not authorized/i, [13], "privilege_missing", false],
  [/interrupted/i, [11601], "cancelled", false],
  [
    /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|Server selection timed out|connect/i,
    [],
    "unreachable",
    true,
  ],
];

/** Driver failures become engine errors; the message keeps the server text, never the config. */
export function translate(cause: unknown, context: string): EngineError {
  if (cause instanceof EngineError) return cause;
  const message = cause instanceof Error ? cause.message : String(cause);
  const parsed = v.safeParse(driverError, cause);
  const code = parsed.success ? Number(parsed.output.code ?? 0) : 0;
  const match = KINDS.find(([pattern, codes]) => codes.includes(code) || pattern.test(message));
  if (match === undefined)
    return new EngineError("batch_failed", `${context}: ${message}`, { code });
  return new EngineError(match[2], `${context}: ${message}`, { code }, match[3]);
}

export async function guarded<T>(context: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (cause: unknown) {
    throw translate(cause, context);
  }
}

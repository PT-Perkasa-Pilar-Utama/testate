/**
 * Where a reading's values come from (#38): a database adapter through its engine, an SFTP login
 * through the files resolver, so netguard, sealed secrets and host-key trust apply as when
 * browsing. The monitor keeps each host's login open across ticks (#101): one SSH login per host,
 * not one every 30 seconds in its auth log.
 */
import { toConnectionConfig } from "../../lib/engines/connection.ts";
import type { EngineRegistry } from "../../lib/engines/index.ts";
import { AppError } from "../../lib/http/index.ts";
import { readHost } from "../../lib/resources/host.ts";
import type { Pause } from "../../lib/resources/host.ts";
import { reasonOf } from "../../lib/resources/read.ts";
import type { ResourceRead } from "../../lib/resources/read.ts";
import type { KeyRing } from "../../lib/sealed/index.ts";
import type { FileSource } from "../../lib/files/index.ts";
import type { FilesResolver } from "../adapters/adapters.files.ts";
import type { AdapterRecord } from "../adapters/adapters.repository.ts";
import { CONFIG_COLUMN, openSecrets } from "../adapters/adapters.secrets.ts";
import type { ReadingsDeps } from "./readings.service.ts";

export type ReadingSourceDeps = {
  engines: Pick<EngineRegistry, "require">;
  ring: KeyRing;
  files: FilesResolver;
  /** Between the two reads of a counter; tests pass one that does not wait. */
  pause?: Pause;
  /** Milliseconds since the epoch, for the wait after a refusal; tests move it. */
  now?: () => number;
};

/**
 * How long the poller leaves a host alone after a login that read nothing: an untrusted host key,
 * a wrong password, a host that is down. Without it each tick is one more failed SSH login in the
 * host's auth log. ponytail: a fixed 5 minutes; back off further if a host stays down for days.
 */
const RETRY_MS = 5 * 60_000;

/** A login that read nothing: the adapter as it was then, when, and the first reason given. */
type Refusal = { stamp: string; at: number; reason: string };

const refusedRead = (reason: string): ResourceRead => ({
  values: [],
  unavailable: [{ key: "adapter", reason }],
});

/** A kept login: the adapter as it was when opened, and whether a read is still on it. */
type Kept = { stamp: string; source: Promise<FileSource>; busy: boolean };

export type ReadingSources = Pick<ReadingsDeps, "readServer" | "readHost"> & {
  /** Closes the kept logins of adapters not in `live`: deleted, or no longer read. */
  release(live: ReadonlySet<string>): Promise<void>;
  closeAll(): Promise<void>;
};

async function closeKept(kept: Kept): Promise<void> {
  const source = await kept.source.catch(() => null);
  await source?.close().catch(() => undefined);
}

async function readOnce(source: FileSource, pause: Pause | undefined): Promise<ResourceRead> {
  if (source.host === undefined)
    throw new AppError("ENGINE_UNSUPPORTED", "this adapter's files have no host to read");
  // The disk is the one under the adapter's own root, which the source resolves "" to.
  return readHost(source.host, "", pause);
}

export function readingSources(deps: ReadingSourceDeps): ReadingSources {
  const kept = new Map<string, Kept>();
  const refused = new Map<string, Refusal>();
  const now = deps.now ?? Date.now;
  const open = (adapter: AdapterRecord, trustAs: string | null): Promise<FileSource> => {
    const kind = adapter.kind === "logs" ? "logs" : "storage";
    return deps.files
      .resolve(adapter.project_id, adapter.id, trustAs, kind)
      .then(({ source }) => source);
  };
  const drop = async (id: string): Promise<void> => {
    const entry = kept.get(id);
    kept.delete(id);
    if (entry !== undefined) await closeKept(entry);
  };
  /** The kept login, or a fresh one when the adapter changed or a late read still holds it. */
  const keptFor = async (adapter: AdapterRecord): Promise<Kept> => {
    const entry = kept.get(adapter.id);
    if (entry !== undefined && entry.stamp === adapter.updated_at && !entry.busy) return entry;
    await drop(adapter.id);
    const fresh = { stamp: adapter.updated_at, source: open(adapter, null), busy: false };
    kept.set(adapter.id, fresh);
    return fresh;
  };
  /** The last refusal, while it is recent and the adapter has not changed since. */
  const recentRefusal = (adapter: AdapterRecord): Refusal | null => {
    const refusal = refused.get(adapter.id);
    if (refusal === undefined) return null;
    if (refusal.stamp === adapter.updated_at && now() - refusal.at < RETRY_MS) return refusal;
    refused.delete(adapter.id);
    return null;
  };
  const refuse = async (adapter: AdapterRecord, reason: string): Promise<void> => {
    refused.set(adapter.id, { stamp: adapter.updated_at, at: now(), reason });
    await drop(adapter.id);
  };
  const readKept = async (adapter: AdapterRecord): Promise<ResourceRead> => {
    const refusal = recentRefusal(adapter);
    if (refusal !== null) return refusedRead(refusal.reason);
    const entry = await keptFor(adapter);
    entry.busy = true;
    try {
      const read = await readOnce(await entry.source, deps.pause);
      entry.busy = false;
      // Every part failed: the login is refused or dead, so wait before the next attempt.
      if (read.values.length === 0)
        await refuse(adapter, read.unavailable[0]?.reason ?? "the host answered nothing");
      return read;
    } catch (cause: unknown) {
      if (kept.get(adapter.id) === entry) await refuse(adapter, reasonOf(cause));
      throw cause;
    }
  };
  return {
    async readServer(adapter: AdapterRecord): Promise<ResourceRead> {
      const secrets = await openSecrets(
        deps.ring,
        adapter.id,
        CONFIG_COLUMN,
        adapter.config_sealed
      );
      const config = toConnectionConfig(adapter.engine, adapter.config, secrets);
      return deps.engines
        .require(adapter.engine)
        .readResources({ connectionId: adapter.id, config });
    },
    async readHost(adapter, trustAs, keep) {
      if (!keep) {
        const source = await open(adapter, trustAs);
        try {
          return await readOnce(source, deps.pause);
        } finally {
          await source.close();
        }
      }
      return readKept(adapter);
    },
    async release(live) {
      for (const id of refused.keys()) if (!live.has(id)) refused.delete(id);
      await Promise.all([...kept.keys()].filter((id) => !live.has(id)).map(drop));
    },
    async closeAll() {
      await Promise.all([...kept.keys()].map(drop));
    },
  };
}

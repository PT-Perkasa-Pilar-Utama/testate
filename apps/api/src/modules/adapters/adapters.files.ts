import { logfileConfigSchema } from "@testate/shared";
import type { Engine, FileProbeResult, JsonObject } from "@testate/shared";
import * as v from "valibot";

import type { FileSource, HostKey } from "../../lib/files/index.ts";
import type { OpenFileSource } from "../../lib/files/open.ts";
import { AppError, notFound } from "../../lib/http/index.ts";
import type { CheckedTarget, Check, Verdict } from "../../lib/netguard/index.ts";
import type { KeyRing } from "../../lib/sealed/index.ts";
import { TIER_OF_ENGINE, validateConfig } from "./adapters.config.ts";
import { refusal } from "./adapters.helpers.ts";
import { splitGlob } from "../../lib/logs/read.ts";
import { fileTargetOf } from "./adapters.logfile.ts";
import type { HostKeysRepository } from "./adapters.hostkeys.ts";
import type { FileProbeFn } from "./adapters.probe.ts";
import type { AdapterRecord, AdaptersRepository } from "./adapters.repository.ts";
import { CONFIG_COLUMN, openSecrets } from "./adapters.secrets.ts";
import type { Secrets } from "./adapters.secrets.ts";

export type FilesResolverDeps = {
  repo: Pick<AdaptersRepository, "byId">;
  hostKeys: HostKeysRepository;
  ring: KeyRing;
  netguard: { check(input: Check): Promise<Verdict> };
  open: OpenFileSource;
  now: () => Date;
};

/** A checked, opened storage adapter; the caller closes it (05 §5.5 `resolveFiles`). */
export type ResolvedFiles = {
  adapter: AdapterRecord;
  source: FileSource;
  /** The key the server presented on the last connect, for `acceptHostKey`. */
  presented: () => HostKey | null;
};

export type FilesResolver = {
  /**
   * `trustAs` is the user who may trust a first-seen host key; tokens pass null. `kind` is the
   * adapter kind the caller reads: storage screens a Files adapter, the Logs tier a `logfile` one.
   */
  resolve(
    projectId: string,
    adapterId: string,
    trustAs: string | null,
    kind?: "storage" | "logs"
  ): Promise<ResolvedFiles>;
};

const KIND_REFUSAL = {
  storage: "browsing needs a Files adapter",
  logs: "reading logs needs a Logs adapter",
} as const;

export function requireStorage(
  adapter: AdapterRecord | null,
  projectId: string,
  kind: "storage" | "logs" = "storage"
): AdapterRecord {
  if (adapter === null || adapter.project_id !== projectId) throw notFound("adapter");
  if (adapter.kind !== kind)
    throw new AppError("ENGINE_UNSUPPORTED", KIND_REFUSAL[kind], { reason: "tier" });
  return adapter;
}

type OpenTarget = { engine: Engine; config: JsonObject };

/** The storage engine and config to open: a `logfile` adapter opens as its transport. */
function openAs(engine: Engine, config: JsonObject): OpenTarget {
  if (engine !== "logfile") return { engine, config };
  return fileTargetOf(v.parse(logfileConfigSchema, config));
}

/**
 * Address check, opened secrets, and host-key trust in one place, so storage, imports, and the
 * agent all see a checked source and never a credential. The SSH host key is trusted on first use
 * and stored; a changed key makes the driver refuse with `CONFLICT host_key_changed` (05 §5.11).
 */
export function createFilesResolver(deps: FilesResolverDeps): FilesResolver {
  return {
    async resolve(projectId, adapterId, trustAs, kind = "storage") {
      const adapter = requireStorage(deps.repo.byId(adapterId), projectId, kind);
      const secrets: Secrets = await openSecrets(
        deps.ring,
        adapter.id,
        CONFIG_COLUMN,
        adapter.config_sealed
      );
      const validated = validateConfig(adapter.engine, adapter.kind, adapter.config, secrets);
      // An `ingest` adapter's files are Testate's own; the logs service reads them from disk.
      const remote = validated.target;
      if (remote === null)
        throw new AppError("ENGINE_UNSUPPORTED", "this adapter has no remote files", {
          reason: "tier",
        });
      const verdict = await deps.netguard.check({ ...remote, purpose: "files" });
      if (!verdict.allowed) throw refusal(verdict, remote);
      const address = verdict.addresses[0];
      if (address === undefined) throw new AppError("CONFLICT", "no address was resolved");
      const target: CheckedTarget = {
        ...remote,
        purpose: "files",
        address,
      };
      let presented: HostKey | null = null;
      let untrusted = false;
      const opened = openAs(adapter.engine, validated.config);
      const source = deps.open(
        opened.engine,
        opened.config,
        secrets,
        (key) => {
          presented = key;
          const known = deps.hostKeys.byAdapter(adapter.id);
          if (known !== null) return known.fingerprint === key.fingerprint;
          if (trustAs === null) {
            untrusted = true;
            return false;
          }
          deps.hostKeys.replace(adapter.id, {
            key_type: key.type,
            fingerprint: key.fingerprint,
            accepted_by: trustAs,
            accepted_at: deps.now().toISOString(),
          });
          return true;
        },
        target
      );
      return {
        adapter,
        source: untrustedAware(source, () => untrusted),
        presented: () => presented,
      };
    },
  };
}

/** A token cannot trust a first-seen key; the refusal names that instead of a changed key. */
function untrustedAware(source: FileSource, untrusted: () => boolean): FileSource {
  const guard = async <T>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (cause: unknown) {
      if (untrusted() && cause instanceof AppError && cause.code === "CONFLICT") {
        throw new AppError(
          "CONFLICT",
          "the SFTP host key is not trusted yet: a user must browse first",
          {
            reason: "host_key_untrusted",
            details: cause.details?.["details"] ?? {},
          }
        );
      }
      throw cause;
    }
  };
  return {
    list: (path, query) => guard(() => source.list(path, query)),
    stat: (path) => guard(() => source.stat(path)),
    read: (path) => guard(() => source.read(path)),
    readRange: (path, start, end) => guard(() => source.readRange(path, start, end)),
    put: (path, body) => guard(() => source.put(path, body)),
    remove: (path) => guard(() => source.remove(path)),
    move: (from, to) => guard(() => source.move(from, to)),
    makeDirectory: (path) => guard(() => source.makeDirectory(path)),
    removeDirectory: (path) => guard(() => source.removeDirectory(path)),
    close: () => source.close(),
  };
}

/** Probes a storage target by listing its root (10 §10.3); any host key passes because no row exists yet. */
/** The file names in a directory; one that does not exist yet holds none. */
async function namesIn(source: FileSource, dir: string): Promise<string[]> {
  try {
    const page = await source.list(dir, { limit: 1000 });
    return page.data.filter((entry) => entry.kind === "file").map((entry) => entry.name);
  } catch (cause: unknown) {
    if (cause instanceof AppError && cause.code === "NOT_FOUND") return [];
    throw cause;
  }
}

/**
 * A `logfile` adapter answers when its transport does; a source whose glob matches no file yet is
 * a warning, not a refusal, since a log often appears only once the app first writes it.
 */
async function probeLogfile(
  open: OpenFileSource,
  config: JsonObject,
  secrets: Secrets,
  target?: CheckedTarget
): Promise<FileProbeResult> {
  const parsed = v.parse(logfileConfigSchema, config);
  const opened = fileTargetOf(parsed);
  const source = open(opened.engine, opened.config, secrets, () => true, target);
  const warnings: FileProbeResult["warnings"] = [];
  try {
    for (const logSource of parsed.sources) {
      const { dir, matches } = splitGlob(logSource.glob);
      if (!(await namesIn(source, dir)).some(matches))
        warnings.push({
          code: "no_files",
          message: `${logSource.name}: no file matches ${logSource.glob} yet`,
        });
    }
  } finally {
    await source.close();
  }
  return { engine: "logfile", tier: "logs", reachable: true, warnings };
}

export function createFileProbe(open: OpenFileSource, fallback: FileProbeFn): FileProbeFn {
  return async (
    engine: Engine,
    config: JsonObject,
    secrets: Secrets,
    target?: CheckedTarget
  ): Promise<FileProbeResult> => {
    if (engine === "logfile") return probeLogfile(open, config, secrets, target);
    if (TIER_OF_ENGINE[engine] !== "files") return fallback(engine, config, secrets, target);
    const source = open(engine, config, secrets, () => true, target);
    try {
      await source.list("", { limit: 1 });
    } finally {
      await source.close();
    }
    return { engine, tier: "files", reachable: true, warnings: [] };
  };
}

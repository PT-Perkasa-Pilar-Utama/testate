import type { Engine, FileProbeResult, JsonObject } from "@testate/shared";

import type { FileSource, HostKey } from "../../lib/files/index.ts";
import type { OpenFileSource } from "../../lib/files/open.ts";
import { AppError, notFound } from "../../lib/http/index.ts";
import type { Check, Verdict } from "../../lib/netguard/index.ts";
import type { KeyRing } from "../../lib/sealed/index.ts";
import { TIER_OF_ENGINE, validateConfig } from "./adapters.config.ts";
import { refusal } from "./adapters.helpers.ts";
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
  /** `trustAs` is the user who may trust a first-seen host key; tokens pass null. */
  resolve(projectId: string, adapterId: string, trustAs: string | null): Promise<ResolvedFiles>;
};

export function requireStorage(adapter: AdapterRecord | null, projectId: string): AdapterRecord {
  if (adapter === null || adapter.project_id !== projectId) throw notFound("adapter");
  if (adapter.kind !== "storage") {
    throw new AppError("ENGINE_UNSUPPORTED", "browsing needs a Files adapter", { reason: "tier" });
  }
  return adapter;
}

/**
 * Address check, opened secrets, and host-key trust in one place, so storage, imports, and the
 * agent all see a checked source and never a credential. The SSH host key is trusted on first use
 * and stored; a changed key makes the driver refuse with `CONFLICT host_key_changed` (05 §5.11).
 */
export function createFilesResolver(deps: FilesResolverDeps): FilesResolver {
  return {
    async resolve(projectId, adapterId, trustAs) {
      const adapter = requireStorage(deps.repo.byId(adapterId), projectId);
      const secrets: Secrets = await openSecrets(
        deps.ring,
        adapter.id,
        CONFIG_COLUMN,
        adapter.config_sealed
      );
      const validated = validateConfig(adapter.engine, adapter.kind, adapter.config, secrets);
      const verdict = await deps.netguard.check({ ...validated.target, purpose: "files" });
      if (!verdict.allowed) throw refusal(verdict, validated.target);
      let presented: HostKey | null = null;
      let untrusted = false;
      const source = deps.open(adapter.engine, validated.config, secrets, (key) => {
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
      });
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
    put: (path, body) => guard(() => source.put(path, body)),
    remove: (path) => guard(() => source.remove(path)),
    move: (from, to) => guard(() => source.move(from, to)),
    makeDirectory: (path) => guard(() => source.makeDirectory(path)),
    removeDirectory: (path) => guard(() => source.removeDirectory(path)),
    close: () => source.close(),
  };
}

/** Probes a storage target by listing its root (10 §10.3); any host key passes because no row exists yet. */
export function createFileProbe(open: OpenFileSource, fallback: FileProbeFn): FileProbeFn {
  return async (engine: Engine, config: JsonObject, secrets: Secrets): Promise<FileProbeResult> => {
    if (TIER_OF_ENGINE[engine] !== "files") return fallback(engine, config, secrets);
    const source = open(engine, config, secrets, () => true);
    try {
      await source.list("", { limit: 1 });
    } finally {
      await source.close();
    }
    return { engine, tier: "files", reachable: true, warnings: [] };
  };
}

/**
 * Where a reading's values come from (#38): a database adapter through its engine, an SFTP login
 * through the files resolver, so netguard, sealed secrets and host-key trust apply as when
 * browsing.
 */
import { toConnectionConfig } from "../../lib/engines/connection.ts";
import type { EngineRegistry } from "../../lib/engines/index.ts";
import { AppError } from "../../lib/http/index.ts";
import { readHost } from "../../lib/resources/host.ts";
import type { ResourceRead } from "../../lib/resources/read.ts";
import type { KeyRing } from "../../lib/sealed/index.ts";
import type { FilesResolver } from "../adapters/adapters.files.ts";
import type { AdapterRecord } from "../adapters/adapters.repository.ts";
import { CONFIG_COLUMN, openSecrets } from "../adapters/adapters.secrets.ts";
import type { ReadingsDeps } from "./readings.service.ts";

export type ReadingSourceDeps = {
  engines: Pick<EngineRegistry, "require">;
  ring: KeyRing;
  files: FilesResolver;
};

export function readingSources(
  deps: ReadingSourceDeps
): Pick<ReadingsDeps, "readServer" | "readHost"> {
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
    async readHost(adapter: AdapterRecord, trustAs: string | null): Promise<ResourceRead> {
      const kind = adapter.kind === "logs" ? "logs" : "storage";
      const { source } = await deps.files.resolve(adapter.project_id, adapter.id, trustAs, kind);
      try {
        if (source.host === undefined)
          throw new AppError("ENGINE_UNSUPPORTED", "this adapter's files have no host to read");
        // The disk is the one under the adapter's own root, which the source resolves "" to.
        return await readHost(source.host, "");
      } finally {
        await source.close();
      }
    },
  };
}

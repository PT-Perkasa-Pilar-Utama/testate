/**
 * The demo's engine wiring (#demo): `createEngineWiring` with the parts that reach a real server
 * swapped for in-browser ones. Database adapters run on the fake engine, file stores on memory
 * trees, and netguard admits only the demo's own hosts, so no request leaves the page.
 */
import {
  createMemoryBlobStore,
  createSwitchableBlobStore,
} from "../../../api/src/lib/blobstore/index.ts";
import { createFakeEngine } from "../../../api/src/lib/engines/fake/engine.ts";
import type { FakeDatabase } from "../../../api/src/lib/engines/fake/engine.ts";
import type { DbEngine, EngineRegistry } from "../../../api/src/lib/engines/index.ts";
import type { MemoryTree } from "../../../api/src/lib/files/index.ts";
import { createEsApi } from "../../../api/src/lib/logs/elasticsearch/api.ts";
import { createIngestStore } from "../../../api/src/lib/logs/ingest/store.ts";
import { createLokiApi } from "../../../api/src/lib/logs/loki/api.ts";
import { openDocker } from "../../../api/src/lib/logs/docker/connect.ts";
import { createSshShell } from "../../../api/src/lib/logs/journald/shell.ts";
import type { Check, Verdict } from "../../../api/src/lib/netguard/index.ts";
import type { KeyRing } from "../../../api/src/lib/sealed/index.ts";
import type { MetadataDb } from "../../../api/src/lib/db/index.ts";
import { createDockerResolver } from "../../../api/src/modules/adapters/adapters.docker.api.ts";
import { createEsResolver } from "../../../api/src/modules/adapters/adapters.elasticsearch.api.ts";
import {
  createFileProbe,
  createFilesResolver,
} from "../../../api/src/modules/adapters/adapters.files.ts";
import { createHostKeysRepository } from "../../../api/src/modules/adapters/adapters.hostkeys.ts";
import { createLokiResolver } from "../../../api/src/modules/adapters/adapters.loki.api.ts";
import {
  createEngineProbe,
  createScaffoldFileProbe,
} from "../../../api/src/modules/adapters/adapters.probe.ts";
import type { ProbeFn } from "../../../api/src/modules/adapters/adapters.probe.ts";
import { AppError } from "../../../api/src/lib/http/index.ts";
import { createAdaptersRepository } from "../../../api/src/modules/adapters/adapters.repository.ts";
import { createShellResolver } from "../../../api/src/modules/adapters/adapters.shell.ts";
import { createCheckoutsRepository } from "../../../api/src/modules/checkouts/checkouts.repository.ts";
import { createPoliciesRepository } from "../../../api/src/modules/data/data.policies.ts";
import { createDataRepository } from "../../../api/src/modules/data/data.repository.ts";
import { createDiffsRepository } from "../../../api/src/modules/diffs/diffs.repository.ts";
import { createImportsRepository } from "../../../api/src/modules/imports/imports.repository.ts";
import type { ProjectsRepository } from "../../../api/src/modules/projects/projects.repository.ts";
import { createStatesRepository } from "../../../api/src/modules/states/states.repository.ts";
import type { EngineWiring } from "../../../api/src/wiring.ts";
import type { LiveNetguard } from "../../../api/src/boot.ts";
import { memoryOpen } from "../../../api/test/files.ts";

/** Every host the demo's adapters name ends in this; anything else is refused before a connect. */
export const DEMO_DOMAIN = ".demo.internal";
const DEMO_ADDRESS = "10.0.0.5";

/** The netguard refusal names the deny list in Settings, which cannot help here; this says why. */
export function demoNetguard(): LiveNetguard {
  return {
    async check(input: Check): Promise<Verdict> {
      if (input.host.endsWith(DEMO_DOMAIN)) return { allowed: true, addresses: [DEMO_ADDRESS] };
      throw new AppError(
        "HOST_BLOCKED",
        `The demo reaches only its own sample servers, not ${input.host}. Install Testate to connect yours.`,
        { reason: "demo", matched: input.host }
      );
    },
    setDeny: () => undefined,
  };
}

/** The fake engine answers for Postgres, MySQL and MariaDB adapters alike. */
function demoEngines(databases: Map<string, FakeDatabase>): EngineRegistry {
  const engine: DbEngine = createFakeEngine({ databases });
  const served = new Set(["postgres"]);
  return {
    get: (name) => (served.has(name) ? engine : null),
    require(name) {
      if (!served.has(name)) throw new Error(`${name} needs a real Testate server`);
      return engine;
    },
  };
}

/** The probe for any engine but the fake: a sentence, not a test that passes and a job that fails. */
const refuseEngine: ProbeFn = async (engine) => {
  throw new AppError(
    "ENGINE_UNSUPPORTED",
    `${engine} needs a real Testate server; the demo's sample database is PostgreSQL.`,
    { reason: "demo" }
  );
};

export type DemoWorld = { databases: Map<string, FakeDatabase>; trees: Map<string, MemoryTree> };

export function demoWiring(
  ring: KeyRing,
  db: MetadataDb,
  netguard: LiveNetguard,
  projects: ProjectsRepository,
  world: DemoWorld
): EngineWiring {
  const engines = demoEngines(world.databases);
  const adapters = createAdaptersRepository(db);
  const hostKeys = createHostKeysRepository(db);
  const now = (): Date => new Date();
  const sftpKey = { current: "SHA256:demo-sftp-host-key" };
  const open = memoryOpen(world.trees, sftpKey);
  const remote = { repo: adapters, hostKeys, ring, netguard, now };
  return {
    netguard,
    engines,
    adapterLanes: 2,
    probe: createEngineProbe(engines, refuseEngine),
    fileProbe: createFileProbe(
      open,
      createScaffoldFileProbe(),
      createSshShell,
      openDocker,
      createLokiApi,
      createEsApi
    ),
    hostKeys,
    files: createFilesResolver({ ...remote, open }),
    shells: createShellResolver({ ...remote, openShell: createSshShell }),
    dockers: createDockerResolver({ ...remote, openDocker }),
    lokis: createLokiResolver({ ...remote, openLoki: createLokiApi }),
    searches: createEsResolver({ ...remote, openEs: createEsApi }),
    blobs: createSwitchableBlobStore(createMemoryBlobStore()),
    ring,
    adapters,
    states: createStatesRepository(db),
    checkouts: createCheckoutsRepository(db),
    data: createDataRepository(db),
    policies: createPoliciesRepository(db),
    diffs: createDiffsRepository(db),
    imports: createImportsRepository(db),
    dataDir: "/data",
    ingest: createIngestStore("/data/logs-ingest", now),
    projects,
  };
}

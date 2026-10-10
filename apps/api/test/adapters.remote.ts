import type { DockerResolver, OpenDocker } from "../src/modules/adapters/adapters.docker.api.ts";
import { createDockerResolver } from "../src/modules/adapters/adapters.docker.api.ts";
import type { LokiResolver, OpenLoki } from "../src/modules/adapters/adapters.loki.api.ts";
import type { EsResolver, OpenEs } from "../src/modules/adapters/adapters.elasticsearch.api.ts";
import { createEsResolver } from "../src/modules/adapters/adapters.elasticsearch.api.ts";
import { createLokiResolver } from "../src/modules/adapters/adapters.loki.api.ts";
import type {
  OpenShell,
  ShellResolver,
  ShellResolverDeps,
} from "../src/modules/adapters/adapters.shell.ts";
import { createShellResolver } from "../src/modules/adapters/adapters.shell.ts";
import { memoryOpenDocker } from "./docker.ts";
import type { FakeContainer } from "./docker.ts";
import { memoryOpenShell } from "./journald.ts";
import type { JournalRow } from "./journald.ts";
import { memoryOpenEs } from "./elasticsearch.ts";
import type { FakeDoc } from "./elasticsearch.ts";
import { memoryOpenLoki } from "./loki.ts";
import type { FakeStream } from "./loki.ts";

/** The remote log engines' fake hosts, by host name: journals (#86), Docker (#88), Loki (#90). */
export type RemoteHosts = {
  journals: Map<string, JournalRow[]>;
  dockerHosts: Map<string, FakeContainer[]>;
  lokiHosts: Map<string, FakeStream[]>;
  esHosts: Map<string, FakeDoc[]>;
};

export type RemoteResolvers = {
  shells: ShellResolver;
  dockers: DockerResolver;
  lokis: LokiResolver;
  searches: EsResolver;
};

export function remoteHosts(): RemoteHosts {
  return { journals: new Map(), dockerHosts: new Map(), lokiHosts: new Map(), esHosts: new Map() };
}

/** How each engine opens its fake host; the SSH ones behind the SFTP hosts' key. */
export type RemoteOpeners = {
  openShell: OpenShell;
  openDocker: OpenDocker;
  openLoki: OpenLoki;
  openEs: OpenEs;
};

export function remoteOpeners(hosts: RemoteHosts, sftpKey: { current: string }): RemoteOpeners {
  return {
    openShell: memoryOpenShell(hosts.journals, sftpKey),
    openDocker: memoryOpenDocker(hosts.dockerHosts, sftpKey),
    openLoki: memoryOpenLoki(hosts.lokiHosts),
    openEs: memoryOpenEs(hosts.esHosts),
  };
}

export function remoteResolvers(
  deps: Omit<ShellResolverDeps, "openShell">,
  hosts: RemoteHosts,
  sftpKey: { current: string }
): RemoteResolvers {
  const open = remoteOpeners(hosts, sftpKey);
  return {
    shells: createShellResolver({ ...deps, openShell: open.openShell }),
    dockers: createDockerResolver({ ...deps, openDocker: open.openDocker }),
    lokis: createLokiResolver({ ...deps, openLoki: open.openLoki }),
    searches: createEsResolver({ ...deps, openEs: open.openEs }),
  };
}

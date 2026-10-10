/**
 * A checked Docker connection for a `docker` adapter (#88; K1, K6 of
 * docs/decisions/2026-10-10-docker.md): the login and trust journald's resolver applies, then the
 * Engine API over the adapter's transport, and what a first look at the daemon says.
 */
import { dockerConfigSchema } from "@testate/shared";
import type {
  DockerConfig,
  DockerSource,
  EngineWarning,
  FileProbeResult,
  JsonObject,
} from "@testate/shared";
import * as v from "valibot";

import { AppError } from "../../lib/http/index.ts";
import type { DockerApi, DockerRequest } from "../../lib/logs/docker/api.ts";
import type { DockerConnection } from "../../lib/logs/docker/connect.ts";
import type { CheckedTarget } from "../../lib/netguard/index.ts";
import type { HostKeyVerifier } from "../../lib/files/index.ts";
import type { AdapterRecord } from "./adapters.repository.ts";
import type { Secrets } from "./adapters.secrets.ts";
import { checkedLogin, sshConfigOf, trustGuarded } from "./adapters.shell.ts";
import type { ShellResolverDeps } from "./adapters.shell.ts";

export type OpenDocker = (connection: DockerConnection) => DockerApi;

export type DockerResolverDeps = Omit<ShellResolverDeps, "openShell"> & { openDocker: OpenDocker };

export type ResolvedDocker = { adapter: AdapterRecord; config: DockerConfig; api: DockerApi };

export type DockerResolver = {
  /** `trustAs` may trust a first-seen SSH host key; a token passes null and is refused one. */
  resolve(projectId: string, adapterId: string, trustAs: string | null): Promise<ResolvedDocker>;
};

/** The drivers whose logs the Engine API can read back (K6). */
export const READABLE_DRIVERS = new Set(["json-file", "local", "journald"]);
const API_FLOOR = [1, 41];

export function connectionOf(
  config: DockerConfig,
  secrets: Secrets,
  verify: HostKeyVerifier,
  address: string
): DockerConnection {
  if (config.transport === "ssh")
    return {
      transport: "ssh",
      login: { ...sshConfigOf(config, secrets, verify), address },
      socketPath: config.socket_path,
    };
  return {
    transport: "tcp",
    host: config.host,
    address,
    port: config.port ?? 2376,
    scheme: config.scheme,
    cert: config.tls_cert,
    key: secrets["tls_key"],
    ca: config.tls_ca,
  };
}

function trustAware(api: DockerApi, untrusted: () => boolean): DockerApi {
  return {
    get: (request, capBytes) => trustGuarded(() => api.get(request, capBytes), untrusted),
    close: () => api.close(),
  };
}

export function createDockerResolver(deps: DockerResolverDeps): DockerResolver {
  return {
    async resolve(projectId, adapterId, trustAs) {
      const login = await checkedLogin(deps, projectId, adapterId, "docker", trustAs);
      const config = v.parse(dockerConfigSchema, login.config);
      const api = deps.openDocker(
        connectionOf(config, login.secrets, login.trust.verify, login.address)
      );
      return { adapter: login.adapter, config, api: trustAware(api, login.trust.untrusted) };
    },
  };
}

const inspectSchema = v.object({
  Config: v.object({ Tty: v.boolean() }),
  HostConfig: v.object({ LogConfig: v.object({ Type: v.string() }) }),
});
export type ContainerFacts = { tty: boolean; driver: string };

/** One JSON answer of the daemon, parsed at the boundary; null for a 404. */
async function getJson<TSchema extends v.GenericSchema>(
  api: DockerApi,
  request: DockerRequest,
  schema: TSchema
): Promise<v.InferOutput<TSchema> | null> {
  const answer = await api.get(request, 1024 * 1024);
  if (answer.status === 404) return null;
  if (answer.status === 403)
    throw new AppError("ADAPTER_UNREACHABLE", "Docker refused the call", {
      reason: "docker_access",
    });
  if (answer.status !== 200)
    throw new AppError("ADAPTER_UNREACHABLE", `Docker answered ${answer.status}`, {
      status: answer.status,
    });
  return v.parse(schema, JSON.parse(answer.body.toString()));
}

/** The container's TTY and log driver, or null when no container has that name. */
export async function containerFacts(
  api: DockerApi,
  container: string
): Promise<ContainerFacts | null> {
  const facts = await getJson(api, { kind: "inspect", container }, inspectSchema);
  return facts === null ? null : { tty: facts.Config.Tty, driver: facts.HostConfig.LogConfig.Type };
}

function versionAtLeast(version: string, floor: number[]): boolean {
  const parts = version.split(".").map(Number);
  const [major = 0, minor = 0] = parts;
  return major > (floor[0] ?? 0) || (major === floor[0] && minor >= (floor[1] ?? 0));
}

/** The daemon answers and speaks API 1.41 (Engine 20.10) or later; anything older is refused. */
async function checkDaemon(api: DockerApi): Promise<void> {
  const ping = await api.get({ kind: "ping" }, 1024);
  if (ping.status !== 200)
    throw new AppError("ADAPTER_UNREACHABLE", `Docker answered ${ping.status} to a ping`, {
      status: ping.status,
    });
  const version = await getJson(api, { kind: "version" }, v.object({ ApiVersion: v.string() }));
  const api_version = version?.ApiVersion ?? "0";
  if (!versionAtLeast(api_version, API_FLOOR))
    throw new AppError(
      "ENGINE_UNSUPPORTED",
      `Docker API ${api_version} is older than 1.41 (Engine 20.10)`,
      {
        reason: "version",
      }
    );
}

const namesSchema = v.array(v.object({ Names: v.array(v.string()) }));

/** What a source's container says about reading it back (K6). */
function sourceWarnings(
  source: DockerSource,
  facts: ContainerFacts | null,
  names: string
): EngineWarning[] {
  if (facts === null)
    return [
      {
        code: "container_missing",
        message: `no container is named ${source.container} on this host${names}`,
      },
    ];
  if (!READABLE_DRIVERS.has(facts.driver))
    return [
      {
        code: "log_driver",
        message: `${source.container} logs to ${facts.driver}, which Docker cannot read back: use json-file, local or journald`,
      },
    ];
  if (facts.tty)
    return [
      {
        code: "tty",
        message: `${source.container} runs with a TTY: its stdout and stderr are one stream`,
      },
    ];
  return [];
}

async function sourcesWarnings(api: DockerApi, sources: DockerSource[]): Promise<EngineWarning[]> {
  const facts = await Promise.all(sources.map((source) => containerFacts(api, source.container)));
  const listed = facts.includes(null)
    ? await getJson(api, { kind: "containers" }, namesSchema)
    : [];
  const known = (listed ?? []).flatMap((item) => item.Names.map((name) => name.replace(/^\//, "")));
  const names = known.length > 0 ? ` (it has ${known.slice(0, 8).join(", ")})` : "";
  return sources.flatMap((source, n) => sourceWarnings(source, facts[n] ?? null, names));
}

/** Test connection: the daemon, its version, and each source's container; any host key passes. */
export async function probeDocker(
  openDocker: OpenDocker,
  config: JsonObject,
  secrets: Secrets,
  target?: CheckedTarget
): Promise<FileProbeResult> {
  const parsed = v.parse(dockerConfigSchema, config);
  const api = openDocker(connectionOf(parsed, secrets, () => true, target?.address ?? parsed.host));
  const plaintext: EngineWarning[] =
    parsed.transport === "tcp" && parsed.scheme === "http"
      ? [
          {
            code: "plaintext",
            message: "Docker is reached over plain http: anyone on the path can read the logs",
          },
        ]
      : [];
  try {
    await checkDaemon(api);
    const warnings = [...plaintext, ...(await sourcesWarnings(api, parsed.sources))];
    return { engine: "docker", tier: "logs", reachable: true, warnings };
  } catch (cause: unknown) {
    if (cause instanceof AppError && cause.details?.["reason"] === "docker_access")
      return {
        engine: "docker",
        tier: "logs",
        reachable: true,
        warnings: [{ code: "docker_access", message: cause.message }],
      };
    throw cause;
  } finally {
    await api.close();
  }
}

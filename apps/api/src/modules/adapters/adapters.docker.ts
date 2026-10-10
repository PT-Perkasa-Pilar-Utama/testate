/**
 * The `docker` adapter's config (#88; K1, K3 of docs/decisions/2026-10-10-docker.md): an SSH login
 * to the host's socket, or the Engine API over TCP, and one named source per container.
 */
import { dockerConfigSchema, jsonObjectSchema } from "@testate/shared";
import type { DockerConfig, JsonObject } from "@testate/shared";
import * as v from "valibot";

import { sha256 } from "../../lib/password/index.ts";
import { invalid, parseWith, validateSecrets } from "./adapters.config.ts";
import type { ValidatedConfig } from "./adapters.config.ts";
import type { Secrets } from "./adapters.secrets.ts";

type TcpConfig = Extract<DockerConfig, { transport: "tcp" }>;

/** Over TCP the only secret is a client certificate's key, and it comes with its certificate. */
function validateClientKey(config: TcpConfig, secrets: Secrets): void {
  const unknown = Object.keys(secrets).find((key) => key !== "tls_key");
  if (unknown !== undefined)
    throw invalid(`secret ${unknown} is not used by docker over tcp`, { key: unknown });
  if ((config.tls_cert !== undefined) !== "tls_key" in secrets)
    throw invalid("a client certificate and its key go together", {
      keys: ["tls_cert", "tls_key"],
    });
  if (config.tls_cert !== undefined && config.scheme === "http")
    throw invalid("a client certificate needs https", { key: "scheme" });
}

export function validateDocker(config: JsonObject, secrets: Secrets): ValidatedConfig {
  const parsed = parseWith(dockerConfigSchema, config);
  if (parsed.transport === "ssh") validateSecrets("sftp", secrets);
  else validateClientKey(parsed, secrets);
  const target = {
    host: parsed.host,
    port: parsed.port ?? (parsed.transport === "ssh" ? 22 : 2376),
  };
  const login = parsed.transport === "ssh" ? `${parsed.user}|${parsed.socket_path}` : parsed.scheme;
  return {
    kind: "logs",
    tier: "logs",
    config: v.parse(jsonObjectSchema, { ...parsed, port: target.port }),
    target,
    targetHash: sha256(`docker|${parsed.transport}|${target.host}|${target.port}|${login}`),
  };
}

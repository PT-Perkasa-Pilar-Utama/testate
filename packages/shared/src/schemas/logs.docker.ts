import * as v from "valibot";

import { logFormatSchema, logSourceNameSchema, safePatternSchema } from "./logs.ts";

/**
 * The `docker` log engine (#88; K1–K7 of docs/decisions/2026-10-10-docker.md): a Docker host's
 * container logs through the Engine API, over an SSH channel to its socket or over HTTPS.
 */

/** A container name as the Engine API takes it in a path (K2). */
export const DOCKER_CONTAINER = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$/;

/** An absolute socket path on the host: no space, no `..` (K1). */
export const DOCKER_SOCKET = /^\/[A-Za-z0-9._/-]{1,255}$/;

export const dockerSourceSchema = v.pipe(
  v.object({
    name: logSourceNameSchema,
    container: v.pipe(
      v.string(),
      v.regex(DOCKER_CONTAINER, "A container name holds letters, digits and _ . - only.")
    ),
    format: v.optional(logFormatSchema, "plain"),
    regex: v.optional(safePatternSchema),
    patterns: v.optional(v.array(safePatternSchema), []),
  }),
  v.check(
    (source) => source.format !== "regex" || source.regex !== undefined,
    "The regex format needs a pattern."
  )
);
export type DockerSource = v.InferOutput<typeof dockerSourceSchema>;

const sourcesSchema = v.pipe(
  v.array(dockerSourceSchema),
  v.minLength(1, "Add at least one source."),
  v.maxLength(32),
  v.check(
    (sources) => new Set(sources.map((source) => source.name)).size === sources.length,
    "Each source needs its own name."
  )
);

const text = v.pipe(v.string(), v.minLength(1), v.maxLength(512));
const port = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65535));
const pem = v.pipe(
  v.string(),
  v.maxLength(16 * 1024),
  v.startsWith("-----BEGIN ", "Paste the certificate in PEM form.")
);

export const dockerConfigSchema = v.variant("transport", [
  v.object({
    transport: v.literal("ssh"),
    host: text,
    port: v.optional(port),
    user: text,
    socket_path: v.optional(
      v.pipe(
        v.string(),
        v.regex(DOCKER_SOCKET, "An absolute path, like /var/run/docker.sock."),
        v.check((path) => !path.split("/").includes(".."), "A socket path has no ..")
      ),
      "/var/run/docker.sock"
    ),
    sources: sourcesSchema,
  }),
  v.object({
    transport: v.literal("tcp"),
    host: text,
    port: v.optional(port),
    scheme: v.optional(v.picklist(["https", "http"]), "https"),
    /** A client certificate; its key is the secret `tls_key`. */
    tls_cert: v.optional(pem),
    /** The CA the daemon's certificate is checked against, when it is not a public one. */
    tls_ca: v.optional(pem),
    sources: sourcesSchema,
  }),
]);
export type DockerConfig = v.InferOutput<typeof dockerConfigSchema>;

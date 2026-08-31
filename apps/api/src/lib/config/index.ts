import * as v from "valibot";

const boolean = v.pipe(
  v.optional(v.picklist(["true", "false", "1", "0"]), "false"),
  v.transform((value) => value === "true" || value === "1")
);

const integer = (
  fallback: number,
  min: number,
  max: number
): v.GenericSchema<string | undefined, number> =>
  v.pipe(
    v.optional(v.string(), String(fallback)),
    v.transform(Number),
    v.integer(),
    v.minValue(min),
    v.maxValue(max)
  );

const basePath = v.pipe(
  v.optional(v.string(), "/"),
  v.check(
    (value) => value === "/" || (value.startsWith("/") && !value.endsWith("/")),
    "must start with / and not end with /"
  )
);

export const configSchema = v.object({
  PORT: integer(7378, 1, 65535),
  TESTATE_ENV: v.optional(v.picklist(["development", "test", "production"]), "production"),
  TESTATE_DATA_DIR: v.optional(v.string(), "/data"),
  TESTATE_BASE_PATH: basePath,
  TESTATE_PUBLIC_URL: v.optional(v.pipe(v.string(), v.url())),
  TESTATE_SECRETS_ACTIVE_KEY: v.pipe(
    v.string(),
    v.minLength(1, "TESTATE_SECRETS_ACTIVE_KEY is not set")
  ),
  TESTATE_SECRETS_ACCEPT_UNREADABLE: boolean,
  TESTATE_ADMIN_USER: v.optional(v.string(), "admin"),
  TESTATE_ADMIN_PASSWORD: v.optional(v.string()),
  /** Recovery for a forgotten admin password (22 §22.2 step 8); remove it after the next login. */
  TESTATE_ADMIN_PASSWORD_RESET: boolean,
  TESTATE_TRUST_PROXY: boolean,
  TESTATE_MAX_UPLOAD_MB: integer(50, 1, 4096),
  TESTATE_JOB_CONCURRENCY: integer(2, 1, 16),
  TESTATE_STORE: v.optional(v.picklist(["local", "s3"])),
  TESTATE_S3_BUCKET: v.optional(v.string()),
  TESTATE_S3_PREFIX: v.optional(v.string(), ""),
  TESTATE_S3_REGION: v.optional(v.string()),
  TESTATE_S3_ENDPOINT: v.optional(v.string()),
  TESTATE_S3_ACCESS_KEY_ID: v.optional(v.string()),
  TESTATE_S3_SECRET_ACCESS_KEY: v.optional(v.string()),
  TESTATE_S3_VIRTUAL_HOSTED: boolean,
  TESTATE_LOG_DIR: v.optional(v.string()),
  TESTATE_LOG_RETENTION_DAYS: integer(30, 1, 3650),
  TESTATE_LOG_STDOUT: v.pipe(
    v.optional(v.picklist(["true", "false", "1", "0"]), "true"),
    v.transform((value) => value === "true" || value === "1")
  ),
  TESTATE_LOG_SAMPLE_RATE: v.pipe(
    v.optional(v.string(), "1"),
    v.transform(Number),
    v.minValue(0),
    v.maxValue(1)
  ),
  TESTATE_LOG_SLOW_MS: integer(2000, 0, 600000),
  TESTATE_LOG_STACKS: boolean,
  TESTATE_RESET_SEED: v.optional(v.picklist(["dev", "qa"]), "qa"),
});

export type Config = v.InferOutput<typeof configSchema>;

export type ConfigIssue = { variable: string; message: string };

export class ConfigError extends Error {
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    super(issues.map((issue) => `${issue.variable}: ${issue.message}`).join("; "));
    this.name = "ConfigError";
    this.issues = issues;
  }
}

/** Parses the environment once. Every other module reads the returned object, never process.env. */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): Config {
  const result = v.safeParse(configSchema, env);
  if (!result.success) {
    const issues = result.issues.map((issue) => ({
      variable: issue.path?.map((segment) => String(segment.key)).join(".") ?? "env",
      message: issue.message,
    }));
    throw new ConfigError(issues);
  }
  const config = result.output;
  if (
    config.TESTATE_STORE === "s3" &&
    (!config.TESTATE_S3_BUCKET || !config.TESTATE_S3_ACCESS_KEY_ID)
  ) {
    throw new ConfigError([
      {
        variable: "TESTATE_STORE",
        message: "s3 needs TESTATE_S3_BUCKET and TESTATE_S3_ACCESS_KEY_ID",
      },
    ]);
  }
  return config;
}

export function logDir(config: Config): string {
  return config.TESTATE_LOG_DIR ?? `${config.TESTATE_DATA_DIR}/logs`;
}

export function apiPrefix(config: Config): string {
  return config.TESTATE_BASE_PATH === "/" ? "/api/v1" : `${config.TESTATE_BASE_PATH}/api/v1`;
}

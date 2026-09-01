import { describe, expect, it } from "bun:test";

import { ConfigError, apiPrefix, loadConfig, logDir } from "./index.ts";

/** The one variable with no default. Everything else here is about what the parser adds to it. */
const KEY = { TESTATE_SECRETS_ACTIVE_KEY: "a-key" };

function issuesOf(env: Record<string, string>): string[] {
  try {
    loadConfig(env);
  } catch (cause: unknown) {
    return cause instanceof ConfigError
      ? cause.issues.map((issue) => issue.variable)
      : ["not-a-config-error"];
  }
  return [];
}

describe("the environment as the instance reads it", () => {
  it("refuses a boot with no secrets key, and names the variable", () => {
    expect(issuesOf({})).toStrictEqual(["TESTATE_SECRETS_ACTIVE_KEY"]);
  });

  it("takes the documented defaults, so an empty env is a running instance", () => {
    const config = loadConfig(KEY);
    expect(config.PORT).toBe(7378);
    expect(config.TESTATE_ENV).toBe("production");
    expect(config.TESTATE_DATA_DIR).toBe("/data");
    expect(config.TESTATE_JOB_CONCURRENCY).toBe(2);
    expect(config.TESTATE_TRUST_PROXY).toBe(false);
  });

  it("reads 1 and true alike, because a compose file writes either", () => {
    expect(loadConfig({ ...KEY, TESTATE_TRUST_PROXY: "1" }).TESTATE_TRUST_PROXY).toBe(true);
    expect(loadConfig({ ...KEY, TESTATE_TRUST_PROXY: "true" }).TESTATE_TRUST_PROXY).toBe(true);
    expect(loadConfig({ ...KEY, TESTATE_TRUST_PROXY: "0" }).TESTATE_TRUST_PROXY).toBe(false);
  });

  it("refuses a port outside the range rather than binding to nothing", () => {
    expect(issuesOf({ ...KEY, PORT: "0" })).toStrictEqual(["PORT"]);
    expect(issuesOf({ ...KEY, PORT: "70000" })).toStrictEqual(["PORT"]);
    expect(loadConfig({ ...KEY, PORT: "8080" }).PORT).toBe(8080);
  });

  it("refuses a base path with a trailing slash, which would double every URL it builds", () => {
    expect(issuesOf({ ...KEY, TESTATE_BASE_PATH: "/testate/" })).toStrictEqual([
      "TESTATE_BASE_PATH",
    ]);
    expect(issuesOf({ ...KEY, TESTATE_BASE_PATH: "testate" })).toStrictEqual(["TESTATE_BASE_PATH"]);
    expect(loadConfig({ ...KEY, TESTATE_BASE_PATH: "/testate" }).TESTATE_BASE_PATH).toBe(
      "/testate"
    );
  });

  it("refuses an S3 store that names no bucket, at boot rather than at the first write", () => {
    expect(issuesOf({ ...KEY, TESTATE_STORE: "s3" })).toStrictEqual(["TESTATE_STORE"]);
    expect(issuesOf({ ...KEY, TESTATE_STORE: "s3", TESTATE_S3_BUCKET: "states" })).toStrictEqual([
      "TESTATE_STORE",
    ]);
    const full = loadConfig({
      ...KEY,
      TESTATE_STORE: "s3",
      TESTATE_S3_BUCKET: "states",
      TESTATE_S3_ACCESS_KEY_ID: "id",
    });
    expect(full.TESTATE_S3_BUCKET).toBe("states");
  });

  it("hangs the API and the logs off the data dir until either is set on its own", () => {
    const config = loadConfig({ ...KEY, TESTATE_DATA_DIR: "/srv/testate" });
    expect(logDir(config)).toBe("/srv/testate/logs");
    expect(logDir(loadConfig({ ...KEY, TESTATE_LOG_DIR: "/var/log/testate" }))).toBe(
      "/var/log/testate"
    );
    expect(apiPrefix(config)).toBe("/api/v1");
    expect(apiPrefix(loadConfig({ ...KEY, TESTATE_BASE_PATH: "/testate" }))).toBe(
      "/testate/api/v1"
    );
  });
});

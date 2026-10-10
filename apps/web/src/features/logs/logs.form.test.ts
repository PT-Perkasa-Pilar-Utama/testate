import { describe, expect, test } from "bun:test";
import * as v from "valibot";
import type { Adapter, LogfileFormInput } from "@testate/shared";
import { logfileFormSchema } from "@testate/shared";

import { logfileDraftFrom, toLogfileBody, toLogfilePatch } from "./logs.form.ts";

// #69, S1 (docs/decisions/2026-10-10-logs-tier.md): the logfile dialog sends one SFTP or S3
// connection holding named sources, always read-only, and an edit keeps the stored secrets.
const CONFIG = {
  transport: "sftp",
  host: "logs.sit.internal",
  port: 2222,
  user: "deploy",
  root_path: "/home/deploy",
  sources: [
    { name: "api", glob: ".pm2/logs/api-*.log", format: "pm2", patterns: [] },
    {
      name: "worker",
      glob: "worker/*.log",
      format: "regex",
      regex: "^(?<time>\\S+) (?<message>.*)$",
      patterns: ["card=\\d+", "otp=\\w+"],
    },
  ],
};

const ADAPTER: Adapter = {
  id: "a-logs",
  project_id: "p-shop",
  kind: "logs",
  engine: "logfile",
  tier: "logs",
  name: "api-logs",
  mode: "read_only",
  status: "ok",
  status_message: null,
  config: CONFIG,
  credential: { set: true },
  readonly_credential: { set: false },
  excluded_tables: [],
  restore_mode: "atomic",
  lock_timeout_ms: 60000,
  engine_version: null,
  dialect: null,
  capabilities: null,
  strategy: null,
  read_only_enforcement: null,
  last_probe_at: null,
  created_by: null,
  created_by_label: null,
  created_at: "2026-10-10T00:00:00.000Z",
  updated_at: "2026-10-10T00:00:00.000Z",
};

const FORM: LogfileFormInput = {
  name: " api-logs ",
  transport: "sftp",
  sources: [
    { name: "api", glob: ".pm2/logs/api-*.log", format: "pm2", regex: "left over", patterns: "" },
  ],
};

const VALUES = {
  "config.host": "logs.sit.internal",
  "config.port": "2222",
  "config.user": "deploy",
  "config.root_path": "/home/deploy",
  "secret.password": "deploy-secret",
};

/** Each refusal as `path: message`, so a test can say which field it lands under. */
function refusals(input: LogfileFormInput): string[] {
  const result = v.safeParse(logfileFormSchema, input);
  return (result.issues ?? []).map((issue) => `${v.getDotPath(issue)}: ${issue.message}`);
}

const source = (patch: Partial<LogfileFormInput["sources"][number]>) => ({
  name: "api",
  glob: "logs/*.log",
  format: "pm2" as const,
  regex: "",
  patterns: "",
  ...patch,
});

describe("the logfile dialog's body", () => {
  test("is a read-only logs adapter over the transport's own fields, with its sources", () => {
    expect(toLogfileBody(v.parse(logfileFormSchema, FORM), VALUES)).toEqual({
      kind: "logs",
      engine: "logfile",
      name: "api-logs",
      mode: "read_only",
      config: {
        host: "logs.sit.internal",
        port: 2222,
        user: "deploy",
        root_path: "/home/deploy",
        transport: "sftp",
        sources: [{ name: "api", glob: ".pm2/logs/api-*.log", format: "pm2", patterns: [] }],
      },
      secrets: { password: "deploy-secret" },
    });
  });

  test("an edit sends a secret only once one is typed", () => {
    const form = v.parse(logfileFormSchema, FORM);
    const { "secret.password": _typed, ...blank } = VALUES;
    expect(Object.keys(toLogfilePatch(form, blank))).toEqual(["name", "config"]);
    expect(toLogfilePatch(form, VALUES).secrets).toEqual({ password: "deploy-secret" });
  });

  test("an edited adapter seeds the dialog and saves back the config it came with", () => {
    const draft = logfileDraftFrom(ADAPTER);
    const saved = toLogfilePatch(v.parse(logfileFormSchema, draft.input), draft.values);
    expect(draft.values).toEqual({
      "config.host": "logs.sit.internal",
      "config.port": "2222",
      "config.user": "deploy",
      "config.root_path": "/home/deploy",
    });
    expect(saved).toEqual({ name: "api-logs", config: CONFIG });
  });
});

describe("the logfile form's rules", () => {
  test("a regex source needs its pattern, said under the pattern", () => {
    expect(refusals({ ...FORM, sources: [source({ format: "regex" })] })).toEqual([
      "sources.0.regex: The regex format needs a pattern.",
    ]);
  });

  test("a masking pattern that could stall a read is refused by its line", () => {
    expect(refusals({ ...FORM, sources: [source({ patterns: "card=\\d+\n(a+)+" })] })).toEqual([
      "sources.0.patterns: Line 2: A quantifier on a group that repeats can stall every read. Rewrite it without nesting.",
    ]);
  });

  test("two sources may not share a name", () => {
    expect(refusals({ ...FORM, sources: [source({}), source({ glob: "other/*.log" })] })).toEqual([
      "sources: Each source needs its own name.",
    ]);
  });
});

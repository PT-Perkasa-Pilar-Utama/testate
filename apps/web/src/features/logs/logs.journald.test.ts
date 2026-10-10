import { describe, expect, test } from "bun:test";
import * as v from "valibot";
import type { Adapter, JournaldFormInput } from "@testate/shared";
import { journaldFormSchema } from "@testate/shared";

import { journaldDraftFrom, toJournaldBody, toJournaldPatch } from "./logs.journald.ts";
import { sourcesOf } from "./logs.model.ts";

// #86 (docs/decisions/2026-10-10-journald.md): the journal dialog sends one SSH login holding named
// groups of units, always read-only; a unit name that is not one is refused under its box (J2).
const CONFIG = {
  host: "app.sit.internal",
  port: 2222,
  user: "deploy",
  sources: [
    { name: "api", units: ["api.service", "api-worker.service"], patterns: [] },
    { name: "all", units: [], patterns: ["card=\\d+"] },
  ],
};

const ADAPTER: Adapter = {
  id: "a-journal",
  project_id: "p-shop",
  kind: "logs",
  engine: "journald",
  tier: "logs",
  name: "app-journal",
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

const FORM: JournaldFormInput = {
  name: " app-journal ",
  sources: [{ name: "api", units: " api.service,\napi-worker.service  ", patterns: "" }],
};

const VALUES = {
  "config.host": "app.sit.internal",
  "config.port": "2222",
  "config.user": "deploy",
  "secret.password": "deploy-secret",
};

function refusals(input: JournaldFormInput): string[] {
  const result = v.safeParse(journaldFormSchema, input);
  return (result.issues ?? []).map((issue) => `${v.getDotPath(issue)}: ${issue.message}`);
}

describe("the journal dialog's body", () => {
  test("is a read-only journald adapter over an SSH login, its units split into names", () => {
    expect(toJournaldBody(v.parse(journaldFormSchema, FORM), VALUES)).toEqual({
      kind: "logs",
      engine: "journald",
      name: "app-journal",
      mode: "read_only",
      config: {
        host: "app.sit.internal",
        port: 2222,
        user: "deploy",
        sources: [{ name: "api", units: ["api.service", "api-worker.service"], patterns: [] }],
      },
      secrets: { password: "deploy-secret" },
    });
  });

  test("an edit sends a secret only once one is typed", () => {
    const form = v.parse(journaldFormSchema, FORM);
    const { "secret.password": _typed, ...blank } = VALUES;
    expect(Object.keys(toJournaldPatch(form, blank))).toEqual(["name", "config"]);
  });

  test("an edited adapter seeds the dialog and saves back the config it came with", () => {
    const draft = journaldDraftFrom(ADAPTER);
    const saved = toJournaldPatch(v.parse(journaldFormSchema, draft.input), draft.values);
    expect(saved).toEqual({ name: "app-journal", config: CONFIG });
  });

  test("its source names are what the Logs screen and a run's menu offer", () => {
    expect(sourcesOf(ADAPTER).map((source) => source.name)).toEqual(["api", "all"]);
  });
});

describe("the journal form's rules", () => {
  test("a unit name with a shell character is refused under the units box", () => {
    const sources = [{ name: "api", units: "api.service $(reboot)", patterns: "" }];
    expect(refusals({ ...FORM, sources })).toEqual([
      "sources.0.units: $(reboot): A unit name holds letters, digits and : _ . @ - only.",
    ]);
  });

  test("a unit name cannot pass for a journalctl option", () => {
    const sources = [{ name: "api", units: "api.service --merge", patterns: "" }];
    expect(refusals({ ...FORM, sources })).toEqual([
      "sources.0.units: --merge: A unit name cannot start with -.",
    ]);
  });

  test("no units is the whole journal, not a refusal", () => {
    expect(refusals({ ...FORM, sources: [{ name: "all", units: "", patterns: "" }] })).toEqual([]);
  });
});

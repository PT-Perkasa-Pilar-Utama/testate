import { describe, expect, test } from "bun:test";
import * as v from "valibot";
import { ingestFormSchema } from "@testate/shared";

import {
  BLANK_INGEST,
  curlFor,
  ingestDraftFrom,
  toIngestBody,
  toIngestPatch,
} from "./logs.ingest.ts";

// #75, I8 (docs/decisions/2026-10-10-logs-tier.md): "Push from your app" creates a read-only ingest
// adapter with no secret, edits only its name, retention and cap, and shows a line that works.
const FORM = { name: " app-logs ", retention_days: "14", cap_mb: "512" };

/** Each refusal as `path: message`. */
function refusals(input: typeof FORM): string[] {
  const result = v.safeParse(ingestFormSchema, input);
  return (result.issues ?? []).map((issue) => `${v.getDotPath(issue)}: ${issue.message}`);
}

describe("the ingest dialog's bodies", () => {
  test("create a read-only ingest adapter with its retention and cap, and no secret", () => {
    expect(toIngestBody(v.parse(ingestFormSchema, FORM))).toEqual({
      kind: "logs",
      engine: "ingest",
      name: "app-logs",
      mode: "read_only",
      config: { retention_days: 14, cap_mb: 512 },
      secrets: {},
    });
  });

  test("an edit sends the name and the config only, and seeds back what it saved", () => {
    const patch = toIngestPatch(v.parse(ingestFormSchema, FORM));
    expect(patch).toEqual({ name: "app-logs", config: { retention_days: 14, cap_mb: 512 } });
    expect(
      ingestDraftFrom({ name: "app-logs", config: { retention_days: 14, cap_mb: 512 } })
    ).toEqual({ name: "app-logs", retention_days: "14", cap_mb: "512" });
  });

  test("an adapter saved without a cap seeds the defaults the API applies", () => {
    expect(ingestDraftFrom({ name: "x", config: {} })).toEqual({ ...BLANK_INGEST, name: "x" });
  });
});

describe("the ingest form's rules", () => {
  test("keeps retention to whole days 1-90 and the cap to whole MB 1-10240, each under its field", () => {
    expect(refusals({ ...FORM, retention_days: "0", cap_mb: "1.5" })).toEqual([
      "retention_days: Keep logs for 1 to 90 days.",
      "cap_mb: Cap the logs at 1 to 10240 MB.",
    ]);
  });
});

describe("the line to paste", () => {
  test("posts one testate line with the token to the push URL", () => {
    const line = curlFor("https://testate.local/api/v1/ingest/a1", "tsi_abc");
    expect(line.split("\n")).toEqual([
      "curl -X POST https://testate.local/api/v1/ingest/a1 \\",
      '  -H "Authorization: Bearer tsi_abc" \\',
      '  -H "Content-Type: application/x-ndjson" \\',
      `  --data-binary '{"level":"info","message":"hello from my app","service":{"name":"api"}}'`,
    ]);
  });
});

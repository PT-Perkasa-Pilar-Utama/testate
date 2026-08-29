import { describe, expect, test } from "bun:test";

import { migrationBody, sectionPatch } from "./settings.presenter.ts";

const ROWS = [
  { key: "retention.stash_keep", name: "stash_keep", value: "5", locked: false },
  { key: "retention.diff_days", name: "diff_days", value: "7", locked: true },
  { key: "retention.audit_days", name: "audit_days", value: "365", locked: false },
];
const S3 = {
  bucket: " exports ",
  prefix: "store/",
  region: "",
  endpoint: "http://127.0.0.1:9010",
  virtual_hosted: false,
  access_key_id: "k",
  secret_access_key: "s",
};

describe("settings feature", () => {
  test("a section patch carries edited, unlocked keys only (story 120)", () => {
    const drafts = new Map([
      ["retention.stash_keep", "8"],
      ["retention.diff_days", "9"],
      ["retention.audit_days", "365"],
    ]);
    expect(sectionPatch("retention", ROWS, drafts)).toStrictEqual({
      retention: { stash_keep: 8 },
    });
    expect(sectionPatch("retention", ROWS, new Map())).toStrictEqual({ retention: {} });
  });

  test("the migration body names local or a full S3 target (stories 118, 119)", () => {
    expect(migrationBody("local", S3)).toStrictEqual({ target: { driver: "local" } });
    expect(migrationBody("s3", S3)).toStrictEqual({
      target: {
        driver: "s3",
        s3: {
          bucket: "exports",
          prefix: "store/",
          virtual_hosted: false,
          access_key_id: "k",
          secret_access_key: "s",
          endpoint: "http://127.0.0.1:9010",
        },
      },
    });
  });
});

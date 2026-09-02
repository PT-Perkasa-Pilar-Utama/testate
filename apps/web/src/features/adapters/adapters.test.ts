import { describe, expect, test } from "bun:test";

import {
  ADAPTER_FILTERS_EMPTY,
  matchesAdapterFilters,
  missingRequiredFields,
  toDraftBody,
} from "./adapters.fields.ts";
import type { AdapterFilters } from "./adapters.fields.ts";

describe("missingRequiredFields", () => {
  test("names every required config/secret field the create draft left blank", () => {
    expect(missingRequiredFields("postgres", {})).toStrictEqual([
      "Host",
      "Database",
      "User",
      "Password",
    ]);
  });

  test("passes once every required field is filled; an optional one (Port) never blocks it", () => {
    expect(
      missingRequiredFields("postgres", {
        "config.host": "db.sit.internal",
        "config.database": "shop",
        "config.user": "testate",
        "secret.password": "s3cr3t",
      })
    ).toStrictEqual([]);
  });
});

describe("matchesAdapterFilters", () => {
  const shop = { engine: "postgres", tier: "tabular", mode: "sandbox", status: "ok" } as const;

  test('an unset filter ("") never excludes a row', () => {
    expect(matchesAdapterFilters(shop, ADAPTER_FILTERS_EMPTY)).toBe(true);
  });

  test("every filter that is set must match the row's own value", () => {
    const engineOnly: AdapterFilters = { ...ADAPTER_FILTERS_EMPTY, engine: "postgres" };
    expect(matchesAdapterFilters(shop, engineOnly)).toBe(true);

    const wrongEngine: AdapterFilters = { ...ADAPTER_FILTERS_EMPTY, engine: "mysql" };
    expect(matchesAdapterFilters(shop, wrongEngine)).toBe(false);

    const wrongStatus: AdapterFilters = { ...ADAPTER_FILTERS_EMPTY, status: "error" };
    expect(matchesAdapterFilters(shop, wrongStatus)).toBe(false);

    // Every field has to agree at once: a matching engine cannot rescue a mode that disagrees.
    const rightEngineWrongMode: AdapterFilters = {
      ...ADAPTER_FILTERS_EMPTY,
      engine: "postgres",
      mode: "read_only",
    };
    expect(matchesAdapterFilters(shop, rightEngineWrongMode)).toBe(false);
  });
});

describe("an S3-compatible bucket", () => {
  const values = {
    "config.bucket": "exports",
    "config.region": "auto",
    "config.endpoint": "https://acct.r2.cloudflarestorage.com",
    "secret.access_key_id": "id",
    "secret.secret_access_key": "key",
  };

  test("carries the endpoint through, which is the whole of supporting R2, GCS and the rest", () => {
    const body = toDraftBody("s3", "r2", "sandbox", values);
    expect(body["config"]).toMatchObject({
      bucket: "exports",
      region: "auto",
      endpoint: "https://acct.r2.cloudflarestorage.com",
    });
  });

  test("sends the addressing style either way, because off is an answer and not a blank", () => {
    // A text field left empty means "not set" and is dropped. A switch left off means path-style,
    // which is what every store but Amazon's own wants, and the API has to be told so.
    expect(toDraftBody("s3", "r2", "sandbox", values)["config"]).toMatchObject({
      virtual_hosted: false,
    });
    expect(
      toDraftBody("s3", "aws", "sandbox", { ...values, "config.virtual_hosted": "true" })["config"]
    ).toMatchObject({ virtual_hosted: true });
  });
});

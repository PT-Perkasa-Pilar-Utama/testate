import { describe, expect, test } from "bun:test";

import {
  ADAPTER_FILTERS_EMPTY,
  matchesAdapterFilters,
  missingRequiredFields,
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

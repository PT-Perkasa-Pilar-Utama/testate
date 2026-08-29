import { describe, expect, test } from "bun:test";

import { extensionOf } from "./storage.model.ts";
import { crumbsOf, parentOf } from "./storage.presenter.ts";

describe("storage feature", () => {
  test("crumbs and parents follow the path segments", () => {
    expect(crumbsOf("exports/2026/08")).toEqual([
      { name: "exports", path: "exports" },
      { name: "2026", path: "exports/2026" },
      { name: "08", path: "exports/2026/08" },
    ]);
    expect(parentOf("exports/2026")).toBe("exports");
    expect(parentOf("exports")).toBe("");
    expect(extensionOf("Report.PDF")).toBe("pdf");
    expect(extensionOf("README")).toBe("");
  });
});

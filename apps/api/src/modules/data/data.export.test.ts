import { describe, expect, it } from "bun:test";
import type { JsonObject } from "@testate/shared";

import { createDataHarness } from "../../../test/data-harness.ts";
import { fileNameOf } from "./data.handler.ts";
import { exportStream, pagedExportStream } from "./data.export.ts";
import type { ExportPage } from "./data.export.ts";

const RESULT = {
  columns: [{ name: "id" }, { name: "note" }],
  rows: [
    { id: 1, note: 'say "hi", twice' },
    { id: 2, note: null },
  ],
};

describe("query export", () => {
  it("streams a CSV header and escaped rows, or one JSON array", async () => {
    const csv = await new Response(exportStream(RESULT, "csv")).text();
    expect(csv).toBe('id,note\n1,"say ""hi"", twice"\n2,\n');
    const json = await new Response(exportStream(RESULT, "json")).text();
    expect(JSON.parse(json)).toEqual(RESULT.rows);
  });
});

async function* pagesOf(pages: ExportPage[]): AsyncGenerator<ExportPage> {
  for (const page of pages) yield page;
}

describe("table export", () => {
  it("writes one header for many pages and joins the JSON into a single array", async () => {
    const columns = [{ name: "id" }];
    const pages: ExportPage[] = [
      { columns, rows: [{ id: 1 }, { id: 2 }], nextCursor: "c1" },
      { columns, rows: [{ id: 3 }], nextCursor: null },
    ];
    const csv = await new Response(pagedExportStream(pagesOf(pages), "csv")).text();
    expect(csv).toBe("id\n1\n2\n3\n");
    const json = await new Response(pagedExportStream(pagesOf(pages), "json")).text();
    expect(JSON.parse(json)).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it("writes a valid empty document when the table holds nothing", async () => {
    const json = await new Response(pagedExportStream(pagesOf([]), "json")).text();
    expect(JSON.parse(json)).toEqual([]);
    expect(await new Response(pagedExportStream(pagesOf([]), "csv")).text()).toBe("");
  });

  it("follows the cursor past the page size instead of stopping at the first page", async () => {
    const h = await createDataHarness();
    const rows: JsonObject[] = [];
    let pages = 0;
    // One row per page, so the cursor has to be followed for the export to be complete.
    const paged = h.data.exportTable(h.viewer, h.adapterId, "public.customers", { limit: 1 });
    for await (const page of paged) {
      pages += 1;
      rows.push(...page.rows);
    }
    const all = await h.data.rows(h.viewer, h.adapterId, "public.customers", { limit: 500 });
    expect(rows).toEqual(all.data);
    expect(rows.length).toBeGreaterThan(1);
    expect(pages).toBe(rows.length);
  });

  it("applies the same filters the grid uses", async () => {
    const h = await createDataHarness();
    const rows: JsonObject[] = [];
    const filtered = h.data.exportTable(h.viewer, h.adapterId, "public.customers", {
      filters: [{ column: "email", op: "eq", value: "a@x.io" }],
    });
    for await (const page of filtered) rows.push(...page.rows);
    expect(rows).toEqual([{ id: 1, email: "a@x.io" }]);
  });

  it("turns a qualified table name into a file name with no path in it", () => {
    expect(fileNameOf("public.orders")).toBe("public-orders");
    expect(fileNameOf("orders")).toBe("orders");
    // The name reaches a Content-Disposition header, so a separator or a quote must not survive.
    const hostile = fileNameOf('../etc/passwd"; x="');
    expect(hostile).not.toContain("/");
    expect(hostile).not.toContain('"');
    expect(hostile).not.toContain("..");
    expect(fileNameOf("///")).toBe("table");
  });
});

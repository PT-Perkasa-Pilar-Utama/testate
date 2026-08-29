import { describe, expect, it } from "bun:test";

import { exportStream } from "./data.export.ts";

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

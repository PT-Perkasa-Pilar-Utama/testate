import { describe, expect, test } from "bun:test";

import { columnIndex, readXlsx, resolveSheet, writeXlsx } from "./index.ts";
import { isZip, readZip, writeZip } from "./zip.ts";

const encoder = new TextEncoder();

/** A two-sheet workbook with shared strings, a boolean, a number, and a gap column, built by hand. */
function sharedStringsWorkbook(): Uint8Array {
  const xml = (text: string): Uint8Array => encoder.encode(text);
  return writeZip([
    {
      name: "xl/workbook.xml",
      bytes: xml(
        '<workbook xmlns:r="x"><sheets><sheet name="Orders &amp; Co" sheetId="1" r:id="rId1"/><sheet name="Notes" sheetId="2" r:id="rId2"/></sheets></workbook>'
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      bytes: xml(
        '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>'
      ),
    },
    {
      name: "xl/sharedStrings.xml",
      bytes: xml(
        "<sst><si><t>id</t></si><si><r><t>na</t></r><r><t>me</t></r></si><si><t>Dina &lt;3</t></si></sst>"
      ),
    },
    {
      name: "xl/worksheets/sheet1.xml",
      bytes: xml(
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="inlineStr"><is><t>ok</t></is></c></row><row r="2"><c r="A2"><v>7</v></c><c r="B2" t="s"><v>2</v></c><c r="D2" t="b"><v>1</v></c></row></sheetData></worksheet>'
      ),
    },
    {
      name: "xl/worksheets/sheet2.xml",
      bytes: xml(
        '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>note</t></is></c></row></sheetData></worksheet>'
      ),
    },
  ]);
}

/** A workbook whose second column carries a date style and whose third carries a plain number. */
function typedWorkbook(): Uint8Array {
  const xml = (text: string): Uint8Array => encoder.encode(text);
  return writeZip([
    {
      name: "xl/workbook.xml",
      bytes: xml(
        '<workbook xmlns:r="x"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>'
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      bytes: xml(
        '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'
      ),
    },
    {
      name: "xl/styles.xml",
      bytes: xml(
        '<styleSheet><numFmts count="1"><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts>' +
          '<cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="165"/><xf numFmtId="22"/></cellXfs></styleSheet>'
      ),
    },
    {
      name: "xl/worksheets/sheet1.xml",
      bytes: xml(
        '<worksheet><sheetData><row r="1">' +
          '<c r="A1" s="0"><v>1234.5</v></c>' +
          '<c r="B1" s="1"><v>46091</v></c>' +
          '<c r="C1" s="2"><v>46091.5</v></c>' +
          "</row></sheetData></worksheet>"
      ),
    },
  ]);
}

describe("xlsx", () => {
  test("reads date cells from their style and leaves plain numbers alone", () => {
    const [row] = readXlsx(typedWorkbook()).rows;
    // A custom dd/mm/yyyy format and the built-in 22 both mean a date; numFmtId 0 does not.
    expect(row).toStrictEqual(["1234.5", "2026-03-10", "2026-03-10T12:00:00Z"]);
  });

  test("a written workbook reads back cell for cell and carries the zip magic", () => {
    const bytes = writeXlsx("sample", [
      ["id", "email"],
      ["1", 'a "quoted" <x> & y'],
    ]);
    expect(isZip(bytes)).toBe(true);
    expect([...readZip(bytes).keys()]).toContain("xl/worksheets/sheet1.xml");
    expect(readXlsx(bytes)).toEqual({
      sheets: ["sample"],
      sheet: "sample",
      rows: [
        ["id", "email"],
        ["1", 'a "quoted" <x> & y'],
      ],
    });
  });

  test("shared strings, rich text, booleans, gaps, and sheet selection by name or index", () => {
    const bytes = sharedStringsWorkbook();
    expect(readXlsx(bytes).rows).toEqual([
      ["id", "name", "", "ok"],
      ["7", "Dina <3", "", "true"],
    ]);
    expect(readXlsx(bytes, "2").sheet).toBe("Notes");
    expect(readXlsx(bytes, "Notes").rows).toEqual([["note"]]);
    expect(() => readXlsx(bytes, "Missing")).toThrow("no sheet Missing");
    expect(resolveSheet(undefined, ["a", "b"])).toBe("a");
    expect(columnIndex("AB7")).toBe(27);
    expect(isZip(encoder.encode("id,name\n"))).toBe(false);
  });
});

/**
 * Writes a workbook whose cells carry types for the end-to-end suite: a date under a custom
 * format, a date-time under a built-in one, and a plain number. `writeXlsx` cannot: it writes
 * inline strings only, and this file has to prove the reader reads a style.
 *
 *   bun scripts/e2e-xlsx.ts .e2e/fixtures/typed.xlsx
 */
import { writeZip } from "../apps/api/src/lib/xlsx/zip.ts";

const target = process.argv[2] ?? "";
if (target === "") throw new Error("usage: bun scripts/e2e-xlsx.ts <path.xlsx>");

const encoder = new TextEncoder();
const part = (text: string): Uint8Array => encoder.encode(`<?xml version="1.0"?>${text}`);

const bytes = writeZip([
  {
    name: "[Content_Types].xml",
    bytes: part(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'
    ),
  },
  {
    name: "_rels/.rels",
    bytes: part(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
    ),
  },
  {
    name: "xl/workbook.xml",
    bytes: part(
      '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'
    ),
  },
  {
    name: "xl/_rels/workbook.xml.rels",
    bytes: part(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'
    ),
  },
  {
    name: "xl/styles.xml",
    bytes: part(
      '<styleSheet><numFmts count="1"><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="165"/><xf numFmtId="22"/></cellXfs></styleSheet>'
    ),
  },
  {
    name: "xl/worksheets/sheet1.xml",
    bytes: part(
      "<worksheet><sheetData>" +
        '<row r="1"><c r="A1" t="inlineStr"><is><t>Email</t></is></c><c r="B1" t="inlineStr"><is><t>Signed</t></is></c><c r="C1" t="inlineStr"><is><t>Seen</t></is></c><c r="D1" t="inlineStr"><is><t>Balance</t></is></c></row>' +
        '<row r="2"><c r="A2" t="inlineStr"><is><t>typed@x.io</t></is></c><c r="B2" s="1"><v>46091</v></c><c r="C2" s="2"><v>46091.5</v></c><c r="D2" s="0"><v>1234.5</v></c></row>' +
        "</sheetData></worksheet>"
    ),
  },
]);

await Bun.write(target, bytes);
console.log(target);

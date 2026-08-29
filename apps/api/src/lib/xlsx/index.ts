import { readZip, writeZip } from "./zip.ts";

export { isZip } from "./zip.ts";

export type Workbook = { sheets: string[]; sheet: string; rows: string[][] };

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&");
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Every `<t>` inside an element, joined: rich-text runs become one string. */
function textOf(xml: string): string {
  return unescapeXml(
    [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1] ?? "").join("")
  );
}

function sharedStrings(entries: Map<string, Uint8Array>): string[] {
  const xml = entries.get("xl/sharedStrings.xml");
  if (xml === undefined) return [];
  return [...decoder.decode(xml).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1] ?? ""));
}

/** `AB` → 27: the zero-based column of a cell reference. */
export function columnIndex(reference: string): number {
  const letters = /^[A-Z]+/.exec(reference)?.[0] ?? "A";
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

type SheetRef = { name: string; path: string };

/** Relationship id → part path; targets are relative to `xl/` unless they start with `/`. */
function relTargets(rels: string): Map<string, string> {
  const targets = new Map<string, string>();
  for (const rel of rels.matchAll(/<Relationship\s[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(rel[0])?.[1];
    const target = /Target="([^"]+)"/.exec(rel[0])?.[1];
    if (id === undefined || target === undefined) continue;
    targets.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target}`);
  }
  return targets;
}

function sheetRefs(entries: Map<string, Uint8Array>): SheetRef[] {
  const workbook = decoder.decode(entries.get("xl/workbook.xml") ?? new Uint8Array());
  const targets = relTargets(
    decoder.decode(entries.get("xl/_rels/workbook.xml.rels") ?? new Uint8Array())
  );
  const refs: SheetRef[] = [];
  for (const sheet of workbook.matchAll(/<sheet\s[^>]*>/g)) {
    const ref = sheetRefOf(sheet[0], targets);
    if (ref !== null) refs.push(ref);
  }
  return refs;
}

function sheetRefOf(tag: string, targets: Map<string, string>): SheetRef | null {
  const name = /name="([^"]*)"/.exec(tag)?.[1];
  const id = /r:id="([^"]+)"/.exec(tag)?.[1] ?? /\sid="([^"]+)"/.exec(tag)?.[1];
  const path = id === undefined ? undefined : targets.get(id);
  return name === undefined || path === undefined ? null : { name: unescapeXml(name), path };
}

/** `""` picks the first sheet, an exact name wins, else a 1-based index (reconflower's resolveSheet). */
export function resolveSheet(selector: string | undefined, names: string[]): string | undefined {
  if (selector === undefined || selector === "") return names[0];
  if (names.includes(selector)) return selector;
  const index = Number.parseInt(selector.trim(), 10);
  return Number.isInteger(index) && index >= 1 ? names[index - 1] : undefined;
}

function cellValue(cell: string, strings: string[]): string {
  const type = /\st="([^"]+)"/.exec(cell)?.[1];
  if (type === "inlineStr") return textOf(cell);
  const value = /<v>([\s\S]*?)<\/v>/.exec(cell)?.[1] ?? "";
  if (type === "s") return strings[Number(value)] ?? "";
  if (type === "b") return value === "1" ? "true" : "false";
  // ponytail: dates stay as Excel serial numbers — style parsing needs the styles part; add when a mapping asks.
  return unescapeXml(value);
}

function sheetRows(xml: string, strings: string[]): string[][] {
  const rows: string[][] = [];
  for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cell of (row[1] ?? "").matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const reference = /\sr="([A-Z]+)\d+"/.exec(cell[1] ?? "")?.[1];
      const index = reference === undefined ? cells.length : columnIndex(reference);
      while (cells.length < index) cells.push("");
      cells[index] = cellValue(cell[0], strings);
    }
    rows.push(cells);
  }
  return rows;
}

/** Reads one sheet of an OOXML workbook as text cells; shared and inline strings both resolve. */
export function readXlsx(bytes: Uint8Array, selector?: string): Workbook {
  const entries = readZip(bytes);
  const refs = sheetRefs(entries);
  const names = refs.map((ref) => ref.name);
  const sheet = resolveSheet(selector, names);
  const ref = refs.find((item) => item.name === sheet);
  if (sheet === undefined || ref === undefined)
    throw new Error(`xlsx: no sheet ${selector ?? ""} (have ${names.join(", ") || "none"})`);
  const xml = entries.get(ref.path);
  if (xml === undefined) throw new Error(`xlsx: sheet part ${ref.path} is missing`);
  return { sheets: names, sheet, rows: sheetRows(decoder.decode(xml), sharedStrings(entries)) };
}

function columnName(index: number): string {
  let name = "";
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/** One-sheet workbook with inline strings; enough for a sample file a spreadsheet opens. */
export function writeXlsx(sheetName: string, rows: string[][]): Uint8Array {
  const body = rows
    .map(
      (row, r) =>
        `<row r="${r + 1}">${row
          .map(
            (cell, c) =>
              `<c r="${columnName(c)}${r + 1}" t="inlineStr"><is><t>${escapeXml(cell)}</t></is></c>`
          )
          .join("")}</row>`
    )
    .join("");
  const xml = (text: string): Uint8Array =>
    encoder.encode(`<?xml version="1.0" encoding="UTF-8"?>${text}`);
  return writeZip([
    {
      name: "[Content_Types].xml",
      bytes: xml(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'
      ),
    },
    {
      name: "_rels/.rels",
      bytes: xml(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
      ),
    },
    {
      name: "xl/workbook.xml",
      bytes: xml(
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      bytes: xml(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'
      ),
    },
    {
      name: "xl/worksheets/sheet1.xml",
      bytes: xml(
        `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`
      ),
    },
  ]);
}

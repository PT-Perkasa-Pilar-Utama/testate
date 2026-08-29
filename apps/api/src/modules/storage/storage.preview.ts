import type { PreviewPayload } from "@testate/shared";
import { jsonValueSchema } from "@testate/shared";
import * as v from "valibot";

import { AppError } from "../../lib/http/index.ts";
import { detectDelimiter, parseCsv } from "../imports/imports.csv.ts";

/** 5 MB preview cap (05 §5.11); larger files download instead. */
export const PREVIEW_CAP_BYTES = 5 * 1024 * 1024;
const TEXT_CAP_CHARS = 256 * 1024;
const CSV_ROWS = 200;

export type PreviewResult =
  | { kind: "payload"; payload: PreviewPayload }
  | { kind: "binary"; bytes: Uint8Array; contentType: string };

const BINARY_TYPES = new Map<string, string>([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["pdf", "application/pdf"],
]);
const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "log",
  "sql",
  "xml",
  "yaml",
  "yml",
  "ini",
  "env",
  "",
]);

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

export function tooLarge(size: number): AppError {
  return new AppError("PAYLOAD_TOO_LARGE", "the file is over the preview cap", {
    size_bytes: size,
    cap_bytes: PREVIEW_CAP_BYTES,
  });
}

/** Drains a stream up to the cap; sizes reported by FTP servers are not trusted. */
export async function collectCapped(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.byteLength;
    if (size > PREVIEW_CAP_BYTES) {
      await stream.cancel().catch(() => undefined);
      throw tooLarge(size);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function csvPreview(text: string): PreviewPayload {
  const rows = parseCsv(text, detectDelimiter(text));
  const [header, ...body] = rows;
  return {
    kind: "csv",
    columns: header ?? [],
    rows: body.slice(0, CSV_ROWS),
    truncated: body.length > CSV_ROWS,
  };
}

function jsonPreview(text: string): PreviewPayload {
  try {
    return { kind: "json", content: v.parse(jsonValueSchema, JSON.parse(text)), truncated: false };
  } catch {
    throw new AppError("VALIDATION_ERROR", "the file is not valid JSON", {});
  }
}

function textPreview(text: string): PreviewPayload {
  return {
    kind: "text",
    content: text.slice(0, TEXT_CAP_CHARS),
    truncated: text.length > TEXT_CAP_CHARS,
  };
}

/** Text, JSON, and CSV become payloads; images and PDF stay bytes for the sandboxed frame (11 §11.3). */
export function renderPreview(name: string, bytes: Uint8Array): PreviewResult {
  const extension = extensionOf(name);
  const binary = BINARY_TYPES.get(extension);
  if (binary !== undefined) return { kind: "binary", bytes, contentType: binary };
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (extension === "csv" || extension === "tsv")
    return { kind: "payload", payload: csvPreview(text) };
  if (extension === "json") return { kind: "payload", payload: jsonPreview(text) };
  if (TEXT_EXTENSIONS.has(extension) || extension === "jsonl")
    return { kind: "payload", payload: textPreview(text) };
  throw new AppError("VALIDATION_ERROR", `no preview for .${extension} files`, { extension });
}

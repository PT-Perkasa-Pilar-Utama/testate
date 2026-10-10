/**
 * Secrets in log lines, masked for viewers and agent tokens before a response leaves the server
 * (docs/decisions/2026-10-10-logs-tier.md, Q5). App logs leak tokens all the time; Testate's own
 * logger refuses them, an app's does not.
 */
import { jsonObjectSchema } from "@testate/shared";
import type { JsonObject, JsonValue } from "@testate/shared";
import * as v from "valibot";

const MASK = "***";
const SECRET_KEY =
  /^(pass(word|wd)?|secret|token|api[_-]?key|authorization|cookie|private[_-]?key)$/i;

/** Each built-in pattern and what its match becomes; `$1`-style groups keep the label visible. */
const BUILT_IN: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, MASK],
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${MASK}`],
  [
    /("(?:pass(?:word|wd)?|secret|token|api[_-]?key|authorization)"\s*:\s*")[^"]*(")/gi,
    `$1${MASK}$2`,
  ],
  [/\b(pass(?:word|wd)?|secret|token|api[_-]?key)(\s*[=:]\s*)[^\s"&,;]+/gi, `$1$2${MASK}`],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, MASK],
  [/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, MASK],
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)[^\s@/]+(@)/gi, `$1${MASK}$2`],
];

export type Masker = (text: string) => { text: string; masked: boolean };

/** The built-in patterns plus an adapter's own (already screened at save by `safePatternSchema`). */
export function createMasker(extra: readonly string[]): Masker {
  const rules: [RegExp, string][] = [
    ...BUILT_IN,
    ...extra.map((pattern): [RegExp, string] => [new RegExp(pattern, "g"), MASK]),
  ];
  return (text) => {
    let out = text;
    for (const [pattern, replacement] of rules) out = out.replace(pattern, replacement);
    return { text: out, masked: out !== text };
  };
}

function maskValue(
  value: JsonValue,
  key: string,
  mask: Masker,
  hits: { masked: boolean }
): JsonValue {
  if (SECRET_KEY.test(key) && value !== null) {
    hits.masked = true;
    return MASK;
  }
  const text = v.safeParse(v.string(), value);
  if (text.success) {
    const result = mask(text.output);
    hits.masked ||= result.masked;
    return result.text;
  }
  if (Array.isArray(value)) return value.map((item) => maskValue(item, "", mask, hits));
  const object = v.safeParse(jsonObjectSchema, value);
  return object.success ? maskObject(object.output, mask, hits) : value;
}

function maskObject(object: JsonObject, mask: Masker, hits: { masked: boolean }): JsonObject {
  return Object.fromEntries(
    Object.entries(object).map(([key, value]) => [key, maskValue(value, key, mask, hits)])
  );
}

export type MaskedEntry = { message: string; fields: JsonObject | null; masked: boolean };

/** A message and its fields, masked; `masked` says whether anything was hidden. */
export function maskEntry(message: string, fields: JsonObject | null, mask: Masker): MaskedEntry {
  const hits = { masked: false };
  const text = mask(message);
  const maskedFields = fields === null ? null : maskObject(fields, mask, hits);
  return { message: text.text, fields: maskedFields, masked: text.masked || hits.masked };
}

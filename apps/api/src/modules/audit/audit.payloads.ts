import type { JsonValue } from "@testate/shared";
import { jsonObjectSchema, jsonValueSchema } from "@testate/shared";
import * as v from "valibot";

import type { MetadataDb } from "../../lib/db/index.ts";

/** Each body, after redaction, is cut here; what is kept is text, no longer JSON (15 §15.3). */
export const PAYLOAD_CAP = 64 * 1024;
export const REDACTED = "••••••••";

/** A key holding one of these words, as a whole word of a snake or camel name, is a secret. */
const SECRET_WORDS = new Set([
  "password",
  "token",
  "secret",
  "passphrase",
  "authorization",
  "cookie",
]);
const SECRET_PHRASES = ["connection_string", "private_key", "access_key"];
/** Whole subtrees that are nothing but secrets, whatever their keys are called. */
const SECRET_TREES = new Set(["secrets", "readonly_secrets"]);
/** Worth recognising, not worth reading in full: the ends stay, the middle goes. */
const IDENTIFIER_KEYS = new Set(["username", "email", "user", "host", "ip"]);

function wordsOf(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== "");
}

export function isSecretKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (SECRET_PHRASES.some((phrase) => lower.includes(phrase))) return true;
  return wordsOf(key).some((word) => SECRET_WORDS.has(word));
}

/** "engineerppu@gmail.com" -> "eng*****************com"; six characters or fewer show nothing. */
export function shorten(value: string): string {
  if (value.length <= 6) return "*".repeat(value.length);
  return `${value.slice(0, 3)}${"*".repeat(value.length - 6)}${value.slice(-3)}`;
}

/** The same value with every secret replaced whole and every identifier shortened, at any depth. */
export function redact(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(redact);
  if (!v.is(jsonObjectSchema, value)) return value;
  const out: Record<string, JsonValue> = {};
  for (const [key, inner] of Object.entries(value)) {
    // `must_change_password: false` and `token_requests_per_minute: 600` say nothing secret;
    // only text and what holds text can.
    if (v.is(v.union([v.boolean(), v.number(), v.null()]), inner)) out[key] = inner;
    else if (SECRET_TREES.has(key) || isSecretKey(key)) out[key] = REDACTED;
    else if (IDENTIFIER_KEYS.has(key) && v.is(v.string(), inner)) out[key] = shorten(inner);
    else out[key] = redact(inner);
  }
  return out;
}

export type KeptBody = { text: string | null; truncated: boolean };

/**
 * A body as it is stored: parsed, redacted, serialised, cut. Text that is not JSON is never kept,
 * because nothing could have redacted it; a note takes its place.
 */
export function keepBody(raw: string | null, note: string | null): KeptBody {
  if (raw === null) {
    return { text: note === null ? null : JSON.stringify({ note }), truncated: false };
  }
  let parsed: JsonValue;
  try {
    parsed = v.parse(jsonValueSchema, JSON.parse(raw));
  } catch {
    return { text: JSON.stringify({ note: "not kept: the body was not JSON" }), truncated: false };
  }
  const text = JSON.stringify(redact(parsed));
  if (text.length <= PAYLOAD_CAP) return { text, truncated: false };
  return { text: text.slice(0, PAYLOAD_CAP), truncated: true };
}

export type PayloadInsert = {
  request_id: string;
  method: string;
  path: string;
  status: number;
  request: KeptBody;
  response: KeptBody;
  created_at: string;
};

export type StoredPayload = {
  method: string;
  path: string;
  status: number;
  request: JsonValue | null;
  response: JsonValue | null;
  request_truncated: boolean;
  response_truncated: boolean;
};

export type PayloadStore = {
  /** Whether any audit row was written under this request; nothing is kept for a request without one. */
  audited(requestId: string): boolean;
  keep(row: PayloadInsert): void;
  get(requestId: string): StoredPayload | null;
  /** Bodies older than `before` go; the rows they belonged to stay (16 §16.1). */
  prune(before: string): number;
};

const storedSchema = v.object({
  method: v.string(),
  path: v.string(),
  status: v.number(),
  request: v.nullable(v.string()),
  response: v.nullable(v.string()),
  request_truncated: v.number(),
  response_truncated: v.number(),
});

/** Kept text reads back as JSON, or as the text itself once the cap has cut it. */
function bodyOf(text: string | null, truncated: boolean): JsonValue | null {
  if (text === null) return null;
  if (truncated) return text;
  return v.parse(jsonValueSchema, JSON.parse(text));
}

export function createPayloadStore(db: MetadataDb): PayloadStore {
  // ponytail: a client that reuses X-Request-Id keeps the first payload under every later row.
  // Ceiling: a deliberately repeated id shows stale bodies; upgrade path: key by the row id instead.
  const insert = db.query(
    `INSERT OR IGNORE INTO audit_payloads (request_id, method, path, status, request, response, request_truncated, response_truncated, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  return {
    audited(requestId) {
      return (
        db.query("SELECT 1 FROM audit_logs WHERE request_id = ? LIMIT 1").get(requestId) !== null
      );
    },
    keep(row) {
      insert.run(
        row.request_id,
        row.method,
        row.path,
        row.status,
        row.request.text,
        row.response.text,
        row.request.truncated ? 1 : 0,
        row.response.truncated ? 1 : 0,
        row.created_at
      );
    },
    get(requestId) {
      const found = db
        .query(
          "SELECT method, path, status, request, response, request_truncated, response_truncated FROM audit_payloads WHERE request_id = ?"
        )
        .get(requestId);
      if (found === null) return null;
      const row = v.parse(storedSchema, found);
      return {
        method: row.method,
        path: row.path,
        status: row.status,
        request: bodyOf(row.request, row.request_truncated === 1),
        response: bodyOf(row.response, row.response_truncated === 1),
        request_truncated: row.request_truncated === 1,
        response_truncated: row.response_truncated === 1,
      };
    },
    prune(before) {
      return db.query("DELETE FROM audit_payloads WHERE created_at < ?").run(before).changes;
    },
  };
}

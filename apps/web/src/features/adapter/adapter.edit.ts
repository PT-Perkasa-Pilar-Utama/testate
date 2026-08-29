import * as v from "valibot";
import type { Adapter, JsonObject, JsonValue } from "@testate/shared";

import { ENGINE_FORMS } from "../adapters/adapters.fields.ts";
import type { Values } from "../adapters/adapters.fields.ts";

export type EditDraft = {
  name: string;
  excluded_tables: string;
  schemas: string;
  restore_mode: "atomic" | "fast";
  lock_timeout_ms: string;
  /** `config.<key>` values and `secret.<key>` / `readonly.<key>` replacements; blank keeps the stored one. */
  values: Values;
};

function list(text: string): string[] {
  return [
    ...new Set(
      text
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item !== "")
    ),
  ];
}

const scalarSchema = v.union([v.string(), v.number(), v.boolean()]);

/** A config value as form text; objects, arrays, and null show as empty. */
function stringOf(value: JsonValue | undefined): string {
  const parsed = v.safeParse(scalarSchema, value);
  return parsed.success ? String(parsed.output) : "";
}

function schemasOf(adapter: Adapter): string[] {
  const stored = adapter.config["schemas"];
  return Array.isArray(stored) ? stored.map(stringOf) : [];
}

function scalarPatch(draft: EditDraft, adapter: Adapter): JsonObject {
  const body: JsonObject = {};
  if (draft.name.trim() !== adapter.name) body["name"] = draft.name.trim();
  const excluded = list(draft.excluded_tables);
  if (excluded.join(",") !== adapter.excluded_tables.join(",")) body["excluded_tables"] = excluded;
  if (draft.restore_mode !== adapter.restore_mode) body["restore_mode"] = draft.restore_mode;
  const timeout = Number(draft.lock_timeout_ms);
  if (timeout !== adapter.lock_timeout_ms) body["lock_timeout_ms"] = timeout;
  return body;
}

/** The whole config when any field or the schema list changed, else null. */
function configPatch(draft: EditDraft, adapter: Adapter): JsonObject | null {
  const config: JsonObject = {};
  let changed = false;
  for (const field of ENGINE_FORMS[adapter.engine].config) {
    const raw = draft.values[`config.${field.key}`] ?? "";
    if (raw !== stringOf(adapter.config[field.key])) changed = true;
    if (raw !== "") config[field.key] = field.type === "number" ? Number(raw) : raw;
  }
  const schemas = list(draft.schemas);
  if (schemas.join(",") !== schemasOf(adapter).join(",")) changed = true;
  if (!changed) return null;
  if (schemas.length > 0) config["schemas"] = schemas;
  return config;
}

/** The dialog draft from the stored adapter; secrets start blank (they are sealed and never shown). */
export function draftFrom(adapter: Adapter): EditDraft {
  const values: Values = {};
  for (const field of ENGINE_FORMS[adapter.engine].config) {
    values[`config.${field.key}`] = stringOf(adapter.config[field.key]);
  }
  return {
    name: adapter.name,
    excluded_tables: adapter.excluded_tables.join(", "),
    schemas: schemasOf(adapter).join(", "),
    restore_mode: adapter.restore_mode,
    lock_timeout_ms: String(adapter.lock_timeout_ms),
    values,
  };
}

function secretsOf(prefix: "secret" | "readonly", draft: EditDraft, adapter: Adapter): JsonObject {
  const out: JsonObject = {};
  for (const field of ENGINE_FORMS[adapter.engine].secrets) {
    const raw = draft.values[`${prefix}.${field.key}`] ?? "";
    if (raw !== "") out[field.key] = raw;
  }
  return out;
}

/**
 * Only what changed goes on the wire (stories 23, 24, 26, 29): a config change carries the whole
 * config so the API can re-probe and, on a new host or database, take a new init state (28).
 */
export function toPatchBody(draft: EditDraft, adapter: Adapter): JsonObject {
  const body = scalarPatch(draft, adapter);
  const config = configPatch(draft, adapter);
  if (config !== null) body["config"] = config;
  const secrets = secretsOf("secret", draft, adapter);
  if (Object.keys(secrets).length > 0) body["secrets"] = secrets;
  const readonly = secretsOf("readonly", draft, adapter);
  if (Object.keys(readonly).length > 0) body["readonly_secrets"] = readonly;
  return body;
}

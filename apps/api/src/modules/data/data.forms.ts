import type { ColumnPolicy, JsonObject, JsonValue } from "@testate/shared";
import type { formValueSchema, rowEditSchema } from "@testate/shared";
import * as v from "valibot";

import type { RowOp, RowValue, RowValues } from "../../lib/engines/index.ts";
import { AppError } from "../../lib/http/index.ts";
import { createToolsService } from "../tools/tools.service.ts";

export type FormValue = v.InferOutput<typeof formValueSchema>;
export type RowEdit = v.InferOutput<typeof rowEditSchema>;

const tools = createToolsService();
const intParam = v.optional(v.pipe(v.number(), v.integer()));

function param(params: JsonObject | undefined, name: string): number | undefined {
  return v.parse(intParam, params?.[name]);
}

type FunctionValue = Extract<FormValue, { kind: "function" }>;
type Applier = (input: string, params: JsonObject | undefined) => Promise<JsonValue> | JsonValue;

/** The function catalogue of 24 §24.1, applied server-side so a raw secret never lands. */
const FUNCTIONS = {
  now: () => new Date().toISOString(),
  uuid_v4: () => crypto.randomUUID(),
  uuid_v7: () => Bun.randomUUIDv7(),
  random_hex: (_input, params) => tools.random(param(params, "bytes") ?? 32, "hex"),
  random_base64: (_input, params) => tools.random(param(params, "bytes") ?? 32, "base64"),
  hash_bcrypt: (input, params) =>
    tools.hash({ algorithm: "bcrypt", value: input, cost: param(params, "cost") ?? 12 }),
  hash_argon2id: (input) => tools.hash({ algorithm: "argon2id", value: input }),
  hash_sha256: (input) => tools.hash({ algorithm: "sha256", value: input }),
  hash_sha512: (input) => tools.hash({ algorithm: "sha512", value: input }),
  hmac_sha256: (input, params) => {
    const secret = v.parse(v.optional(v.string()), params?.["secret"]);
    if (secret === undefined) throw new AppError("VALIDATION_ERROR", "hmac_sha256 needs params.secret");
    return tools.hash({ algorithm: "hmac_sha256", value: input, secret });
  },
} satisfies Record<FunctionValue["name"], Applier>;

export async function applyFunction(value: FunctionValue): Promise<JsonValue> {
  return FUNCTIONS[value.name](value.input ?? "", value.params);
}

/** A policed column must carry its required function (24 §24.4); the error names both. */
export function assertPolicies(values: Record<string, FormValue>, policies: ColumnPolicy[]): void {
  for (const policy of policies) {
    const required = policy.required_function;
    const value = values[policy.column];
    if (required === null || value === undefined) continue;
    if (value.kind !== "function" || value.name !== required.name) {
      throw new AppError("VALIDATION_ERROR", `${policy.column} requires the ${required.name} function`, {
        column: policy.column,
        function: required.name,
      });
    }
  }
}

async function resolveValue(value: FormValue): Promise<RowValue> {
  switch (value.kind) {
    case "value":
      return { kind: "value", value: value.value };
    case "null":
      return { kind: "value", value: null };
    case "default":
      return { kind: "default" };
    case "function":
      return { kind: "value", value: await applyFunction(value) };
  }
}

async function resolveValues(values: Record<string, FormValue>): Promise<RowValues> {
  const out: RowValues = {};
  for (const [column, value] of Object.entries(values)) out[column] = await resolveValue(value);
  return out;
}

/** Form edits to engine ops: policies checked first, then every function applied (06 §6.6 steps 2 and 4). */
export async function toRowOps(edits: RowEdit[], policies: ColumnPolicy[]): Promise<RowOp[]> {
  const ops: RowOp[] = [];
  for (const edit of edits) {
    if (edit.kind === "delete") {
      ops.push({ kind: "delete", pk: edit.pk });
      continue;
    }
    assertPolicies(edit.values, policies);
    const values = await resolveValues(edit.values);
    ops.push(edit.kind === "insert" ? { kind: "insert", values } : { kind: "update", pk: edit.pk, values });
  }
  return ops;
}

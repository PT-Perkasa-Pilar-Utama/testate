import { expect } from "bun:test";
import * as v from "valibot";
import { jsonObjectSchema } from "@testate/shared";
import type { JsonObject } from "@testate/shared";

/**
 * A mock is contract-valid when it parses under its shared schema AND a deliberately
 * broken copy does not. The second half is what keeps this from being a tautology
 * (CODING_STANDARD §1): a schema that accepts everything would pass the first check alone.
 */
export function expectContract<TSchema extends v.GenericSchema>(
  schema: TSchema,
  mock: v.InferInput<TSchema>,
  breakIt: (clone: JsonObject) => void
): void {
  expect(v.safeParse(schema, mock).success).toBe(true);
  const clone = v.parse(jsonObjectSchema, structuredClone(mock));
  breakIt(clone);
  expect(v.safeParse(schema, clone).success).toBe(false);
}

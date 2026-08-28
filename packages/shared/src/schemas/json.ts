import * as v from "valibot";

/** JSON as it travels on the wire: the value type every open dictionary in the contract uses. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const jsonValueSchema: v.GenericSchema<JsonValue> = v.lazy(() =>
  v.union([
    v.string(),
    v.number(),
    v.boolean(),
    v.null(),
    v.array(jsonValueSchema),
    v.record(v.string(), jsonValueSchema),
  ])
);

export const jsonObjectSchema: v.GenericSchema<JsonObject> = v.record(v.string(), jsonValueSchema);

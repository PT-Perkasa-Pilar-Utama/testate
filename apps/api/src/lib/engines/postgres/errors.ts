import * as v from "valibot";

import { EngineError } from "../types.ts";

const driverErrorSchema = v.object({
  errno: v.optional(v.string()),
  code: v.optional(v.string()),
  message: v.optional(v.string()),
});

/** SQLSTATE classes and codes that map to an engine error kind (12 §12.1: drivers' errors never leak). */
const BY_SQLSTATE: readonly [RegExp, EngineError["kind"], boolean][] = [
  [/^28/, "auth_failed", false],
  [/^3D000$/, "unreachable", false],
  [/^08/, "unreachable", true],
  [/^42501$/, "privilege_missing", false],
  [/^55P03$/, "lock_timeout", true],
  [/^57014$/, "cancelled", false],
  [/^40/, "batch_failed", true],
];

function fromSqlstate(sqlstate: string, context: string, message: string): EngineError | null {
  for (const [pattern, kind, retriable] of BY_SQLSTATE) {
    if (pattern.test(sqlstate)) {
      return new EngineError(kind, `${context}: ${message}`, { sqlstate }, retriable);
    }
  }
  return null;
}

/** Translates a driver failure to an EngineError; the message keeps the server text, never the config. */
export function translate(cause: unknown, context: string): EngineError {
  if (cause instanceof EngineError) return cause;
  const parsed = v.safeParse(driverErrorSchema, cause);
  const detail = parsed.success ? parsed.output : {};
  const sqlstate = detail.errno ?? "";
  const message = detail.message ?? String(cause);
  const code = detail.code ?? "";
  const known = fromSqlstate(sqlstate, context, message);
  if (known !== null) return known;
  if (
    /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|CONNECTION_CLOSED|timeout/i.test(
      `${code} ${message}`
    )
  ) {
    return new EngineError("unreachable", `${context}: ${message}`, { code }, true);
  }
  return new EngineError("batch_failed", `${context}: ${message}`, { sqlstate, code });
}

export async function guarded<T>(context: string, task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (cause: unknown) {
    throw translate(cause, context);
  }
}

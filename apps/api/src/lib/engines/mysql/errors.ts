import * as v from "valibot";

import { EngineError } from "../types.ts";

const driverErrorSchema = v.object({
  errno: v.optional(v.union([v.number(), v.string()])),
  code: v.optional(v.string()),
  message: v.optional(v.string()),
});

/** MySQL error numbers that map to an engine error kind (12 §12.1: drivers' errors never leak). */
const BY_ERRNO = new Map<number, [EngineError["kind"], boolean]>([
  [1045, ["auth_failed", false]],
  [1044, ["privilege_missing", false]],
  [1142, ["privilege_missing", false]],
  [1227, ["privilege_missing", false]],
  [1049, ["unreachable", false]],
  [1205, ["lock_timeout", true]],
  [1213, ["batch_failed", true]],
  [1317, ["cancelled", false]],
  [3024, ["cancelled", false]],
  [1969, ["cancelled", false]],
]);

/** Translates a driver failure to an EngineError; the message keeps the server text, never the config. */
export function translate(cause: unknown, context: string): EngineError {
  if (cause instanceof EngineError) return cause;
  const parsed = v.safeParse(driverErrorSchema, cause);
  const detail = parsed.success ? parsed.output : {};
  const errno = Number(detail.errno ?? 0);
  const message = detail.message ?? String(cause);
  const code = detail.code ?? "";
  const known = BY_ERRNO.get(errno);
  if (known !== undefined)
    return new EngineError(known[0], `${context}: ${message}`, { errno }, known[1]);
  if (
    /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|Failed to connect|timeout/i.test(
      `${code} ${message}`
    )
  ) {
    return new EngineError("unreachable", `${context}: ${message}`, { code }, true);
  }
  return new EngineError("batch_failed", `${context}: ${message}`, { errno, code });
}

export async function guarded<T>(context: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (cause: unknown) {
    throw translate(cause, context);
  }
}

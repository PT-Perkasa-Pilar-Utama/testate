import type { Context } from "hono";
import * as v from "valibot";

import { validationError } from "./errors.ts";

export {
  AppError,
  conflict,
  errorResponse,
  forbidden,
  notFound,
  rateLimited,
  unauthorized,
  validationError,
} from "./errors.ts";
export type { ErrorDetails } from "./errors.ts";

/** Every route handler has this shape; routers attach middleware separately. */
export type Handler = (c: Context) => Promise<Response>;

type SuccessStatus = 200 | 201 | 202;

/** Success envelope: `{ data }`. */
export function ok<T>(c: Context, data: T, status: SuccessStatus = 200): Response {
  return c.json({ data }, { status });
}

/** Collection envelope: `{ data, page }`. */
/**
 * A page of rows. `total` is how many match the filter across every page; leave it out and the
 * answer is the honest one this envelope can give on its own: the row count when the whole list is
 * here, and null when there is a page after this one that nobody has counted.
 */
export function okPage<T>(
  c: Context,
  data: T[],
  nextCursor: string | null,
  limit: number,
  total?: number
): Response {
  const counted = total ?? (nextCursor === null ? data.length : null);
  return c.json(
    { data, page: { next_cursor: nextCursor, limit, total: counted } },
    { status: 200 }
  );
}

/** Job-backed operations: `202` with the job and a `Location` header. */
export function accepted<T extends { id: string }>(c: Context, job: T, prefix: string): Response {
  c.header("Location", `${prefix}/jobs/${job.id}`);
  return c.json({ data: job }, { status: 202 });
}

/** A path parameter of a matched route. Hono types it as optional; a matched route always has it. */
export function param(c: Context, name: string): string {
  const value = c.req.param(name);
  if (value === undefined) throw validationError([], "params");
  return value;
}

/* oxlint-disable anti-slop/no-unknown-parameters -- this is the I/O boundary: the schema parses the raw value */
function parseAt<TSchema extends v.GenericSchema>(
  schema: TSchema,
  raw: unknown,
  where: string
): v.InferOutput<TSchema> {
  const result = v.safeParse(schema, raw);
  if (!result.success) throw validationError(result.issues, where);
  return result.output;
}
/* oxlint-enable anti-slop/no-unknown-parameters */

/** Parses the JSON body; a malformed body fails the schema like an empty one. */
export async function parseBody<TSchema extends v.GenericSchema>(
  c: Context,
  schema: TSchema
): Promise<v.InferOutput<TSchema>> {
  const raw = await c.req.json().catch(() => null);
  return parseAt(schema, raw, "body");
}

/** Parses query parameters. Repeated keys arrive as arrays; the schema decides. */
export function parseQuery<TSchema extends v.GenericSchema>(
  c: Context,
  schema: TSchema
): v.InferOutput<TSchema> {
  return parseAt(schema, c.req.queries(), "query");
}

/** Parses path parameters. */
export function parseParams<TSchema extends v.GenericSchema>(
  c: Context,
  schema: TSchema
): v.InferOutput<TSchema> {
  return parseAt(schema, c.req.param(), "params");
}
export { firstQuery } from "./query.ts";
export { waitForJob, waitQuerySchema, waitSeconds } from "./wait.ts";
export type { JobWaiter } from "./wait.ts";
export {
  anonymousLimit,
  bodyLimits,
  hardeningFor,
  installHardening,
  securityHeaders,
} from "./hardening.ts";

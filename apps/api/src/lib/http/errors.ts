import type { Context } from "hono";
import type { BaseIssue } from "valibot";
import type { ErrorCode, JsonObject } from "@testate/shared";
import { ERROR_STATUS } from "@testate/shared";

import type { WideEvent } from "../logger/index.ts";

export type ErrorDetails = JsonObject;

/** The one error type handlers let escape. Everything else is INTERNAL. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: ErrorDetails | undefined;
  readonly retriable: boolean;
  readonly retryAfterSeconds: number | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    details?: ErrorDetails,
    options: { retriable?: boolean; retryAfterSeconds?: number } = {}
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = details;
    this.retriable = options.retriable ?? false;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export const notFound = (what: string): AppError => new AppError("NOT_FOUND", `${what} not found`);
export const conflict = (message: string, details?: ErrorDetails): AppError =>
  new AppError("CONFLICT", message, details);
export const forbidden = (reason: string): AppError =>
  new AppError("FORBIDDEN", "forbidden", { reason });
export const unauthorized = (): AppError => new AppError("UNAUTHORIZED", "authentication required");
export const rateLimited = (retryAfterSeconds: number): AppError =>
  new AppError(
    "RATE_LIMITED",
    "too many requests",
    { retry_after: retryAfterSeconds },
    { retryAfterSeconds }
  );

export function validationError(issues: readonly BaseIssue<unknown>[], where: string): AppError {
  const flattened = issues.map((issue) => ({
    path: `${where}.${issue.path?.map((segment) => String(segment.key)).join(".") ?? ""}`,
    message: issue.message,
  }));
  const first = flattened[0];
  const message = first ? `${first.path} ${first.message}` : "invalid input";
  return new AppError("VALIDATION_ERROR", message, { issues: flattened });
}

type ErrorBody = { error: { code: ErrorCode; message: string; details?: ErrorDetails } };

function toBody(error: AppError): ErrorBody {
  return error.details === undefined
    ? { error: { code: error.code, message: error.message } }
    : { error: { code: error.code, message: error.message, details: error.details } };
}

/** Maps any thrown value to the error envelope and records it on the wide event. */
export function errorResponse(
  c: Context,
  cause: unknown,
  event: WideEvent | undefined,
  stacks: boolean
): Response {
  const error = cause instanceof AppError ? cause : new AppError("INTERNAL", "internal error");
  if (error.details === undefined) {
    event?.error(cause, { code: error.code, retriable: error.retriable, stacks });
  } else {
    event?.error(cause, {
      code: error.code,
      retriable: error.retriable,
      stacks,
      details: error.details,
    });
  }
  const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
  if (error.retryAfterSeconds !== undefined)
    headers.set("Retry-After", String(error.retryAfterSeconds));
  const requestId = c.get("requestId");
  if (requestId !== undefined) headers.set("X-Request-Id", requestId);
  return new Response(JSON.stringify(toBody(error)), { status: error.status, headers });
}

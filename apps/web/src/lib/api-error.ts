import * as v from "valibot";
import type { ErrorCode, JsonObject } from "@testate/shared";

import { ApiError } from "./api-client.ts";

/**
 * What a person reads when a request fails.
 *
 * The API's own messages are written for whoever is reading a log or driving the API: short,
 * lowercase, and occasionally naming a field. Most of them are also perfectly good sentences for a
 * person ("adapter name is taken"), and those pass through with a capital letter and a full stop.
 *
 * These seven never do. "authentication required" and "forbidden" and "internal error" say nothing
 * a person can act on, and a 404 for a row nobody deleted is not their problem to solve. They are
 * replaced outright, whatever the server wrote.
 *
 * The technical text is not lost: it is still in the response, in the wide event and in the audit
 * row. It just no longer lands in a red box on a screen someone is trying to work in.
 */
const REPLACED = {
  UNAUTHORIZED: "Your session has ended. Sign in again.",
  FORBIDDEN: "Your role does not allow this.",
  NOT_FOUND: "That is no longer here. It may have been deleted. Refresh and try again.",
  INTERNAL: "Something went wrong at our end. Try again. Tell an admin if it keeps happening.",
  PAYLOAD_TOO_LARGE: "That file is too large.",
  QUOTA_EXCEEDED: "This project is at its storage quota. Delete a state or raise the quota.",
  RATE_LIMITED: "Too many attempts. Wait a moment and try again.",
} as const satisfies Partial<Record<ErrorCode, string>>;

/** True when the API's validation message was generated from a schema rather than written. */
const fromSchema = (details: JsonObject | undefined): boolean =>
  v.safeParse(v.object({ issues: v.array(v.unknown()) }), details).success;

/** `retry_after` when the server sent one, so the wait is a number rather than "a moment". */
const retryAfter = (details: JsonObject | undefined): number | null => {
  const parsed = v.safeParse(v.object({ retry_after: v.number() }), details);
  return parsed.success ? parsed.output.retry_after : null;
};

/**
 * How long to wait, said the way a person would say it. 887 seconds is "15 minutes", not "887
 * seconds": an account lockout is a quarter of an hour and telling someone to wait "a moment"
 * makes them retry for fifteen minutes instead.
 */
export function waitPhrase(seconds: number): string {
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))} second${seconds < 1.5 ? "" : "s"}`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/** "adapter name is taken" -> "Adapter name is taken." A sentence, not a log line. */
function asSentence(message: string): string {
  const trimmed = message.trim();
  if (trimmed === "") return "";
  const capitalised = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capitalised) ? capitalised : `${capitalised}.`;
}

/**
 * The sentence to show for a failed request. `fallback` says what the person was trying to do, and
 * is used when the server said nothing worth repeating.
 *
 * Not for the query console, the adapter probe, an import's rejected rows, or a checkout's
 * per-adapter outcome. On those screens the database's own words are the answer the person came
 * for, and each of those call sites says so.
 */
export function humanMessage(cause: unknown, fallback: string): string {
  if (!(cause instanceof ApiError)) {
    // A fetch that never reached the API: no code, no message worth repeating.
    return "Could not reach Testate. Check your connection and try again.";
  }
  if (cause.code === "RATE_LIMITED") {
    const wait = retryAfter(cause.details);
    return wait === null
      ? REPLACED.RATE_LIMITED
      : `Too many attempts. Try again in ${waitPhrase(wait)}.`;
  }
  // A validation failure carrying `issues` came from a schema, not from a person: the API builds
  // it as "body.value Invalid length: Expected >=1 but received 0" (`validationError`), which is
  // for whoever is driving the API. One raised by hand carries no issues and is a real sentence
  // ("an HMAC needs a secret"), so that one still passes through.
  if (cause.code === "VALIDATION_ERROR" && fromSchema(cause.details)) return asSentence(fallback);
  if (cause.code in REPLACED) {
    // SAFETY: the `in` check above proved `cause.code` names one of REPLACED's own properties.
    return REPLACED[cause.code as keyof typeof REPLACED];
  }
  const sentence = asSentence(cause.message);
  return sentence === "" ? asSentence(fallback) : sentence;
}

/**
 * An adapter's `status_message`, which is two different things wearing one field.
 *
 * Usually it is the engine's own answer to a failed probe ("connection refused", "password
 * authentication failed"), and that is exactly what an operator needs to read. Sometimes it is a
 * reason code the platform stored itself (17 §17.4), and a person should not be shown a token.
 */
const STATUS_REASONS = {
  credential_unreadable:
    "This adapter's secrets cannot be read with the current key. Re-enter them to seal them again.",
} as const;

export function statusReason(message: string | null): string | null {
  if (message === null) return null;
  return message in STATUS_REASONS
    ? // SAFETY: the `in` check above proved `message` names one of STATUS_REASONS' own properties.
      STATUS_REASONS[message as keyof typeof STATUS_REASONS]
    : message;
}

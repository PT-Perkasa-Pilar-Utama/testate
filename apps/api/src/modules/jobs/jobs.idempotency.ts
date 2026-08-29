import type { Actor, Job, JobKind, JsonObject } from "@testate/shared";

import type { RequestMeta } from "../../lib/http/auth.ts";
import type { JobsService } from "./jobs.service.ts";

/**
 * A request that carried an `Idempotency-Key` (09 §9.3). `body` is what the client sent, not the
 * payload the service builds from it: a payload mints ids, so a retry would never match itself.
 */
export type IdempotentRequest = { key: string; kind: JobKind; body: JsonObject };

/** The idempotent request a header makes, or nothing when the client sent no key. */
export function idempotentRequest(
  meta: RequestMeta,
  kind: JobKind,
  body: JsonObject
): IdempotentRequest | undefined {
  return meta.idempotency_key === undefined ? undefined : { key: meta.idempotency_key, kind, body };
}

export type Replayed<T> = { row: T; job: Job };

/**
 * The job a repeated key already made, paired with the row that job created. Services call this
 * before they write anything: a retry then answers with the first job instead of a second one.
 */
export async function replayWith<T>(
  jobs: Pick<JobsService, "replay">,
  request: IdempotentRequest | undefined,
  actor: Actor,
  rowOf: (jobId: string) => T | null
): Promise<Replayed<T> | null> {
  if (request === undefined) return null;
  const job = await jobs.replay(request, actor);
  if (job === null) return null;
  const row = rowOf(job.id);
  return row === null ? null : { row, job };
}

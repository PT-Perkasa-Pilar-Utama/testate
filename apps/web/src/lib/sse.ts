import * as v from "valibot";
import { jobSchema, jsonObjectSchema } from "@testate/shared";
import type { Job, JsonObject } from "@testate/shared";

const API = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/v1`;

export type JobEvent =
  | { kind: "progress"; progress: JsonObject }
  | { kind: "status"; job: Job }
  | { kind: "heartbeat" };

const progressSchema = jsonObjectSchema;

/** Opens the job event stream; returns the cleanup that closes it. */
export function subscribeJob(jobId: string, onEvent: (event: JobEvent) => void): () => void {
  const source = new EventSource(`${API}/jobs/${jobId}/events`);
  source.addEventListener("progress", (message) => {
    const parsed = v.safeParse(progressSchema, JSON.parse(message.data));
    if (parsed.success) onEvent({ kind: "progress", progress: parsed.output });
  });
  source.addEventListener("status", (message) => {
    const parsed = v.safeParse(jobSchema, JSON.parse(message.data));
    if (parsed.success) onEvent({ kind: "status", job: parsed.output });
  });
  source.addEventListener("heartbeat", () => onEvent({ kind: "heartbeat" }));
  return () => source.close();
}

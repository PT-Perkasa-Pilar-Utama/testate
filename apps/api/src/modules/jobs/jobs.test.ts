import { describe, expect, it } from "bun:test";

import { QA_ACTOR, TOKEN_ACTOR } from "../../lib/mock/fixtures.ts";
import { PROJECT_JOB_MOCK } from "../projects/projects.mock.ts";
import { createJobsService } from "./jobs.service.ts";

const QUEUED_ID = "01991f00-0000-7000-8000-000000000041";

describe("jobs", () => {
  it("refuses to cancel a finished job", async () => {
    const service = createJobsService();
    await expect(service.cancel({ ...TOKEN_ACTOR }, PROJECT_JOB_MOCK.id)).rejects.toThrow(
      "job already finished"
    );
  });

  it("lets only the owner or an admin cancel a queued job", async () => {
    const service = createJobsService();
    await expect(service.cancel({ ...QA_ACTOR }, QUEUED_ID)).rejects.toThrow("forbidden");
    const cancelled = await service.cancel({ ...TOKEN_ACTOR }, QUEUED_ID);
    expect(cancelled.cancel_requested).toBe(true);
  });

  it("exposes the queue position on queued jobs", async () => {
    const service = createJobsService();
    const job = await service.get(QUEUED_ID);
    expect(job.queue_position).toBe(1);
  });
});

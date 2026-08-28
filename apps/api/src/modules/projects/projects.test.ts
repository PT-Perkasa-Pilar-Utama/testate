import { describe, expect, it } from "bun:test";
import { jobSchema, projectSchema, quotaSchema } from "@testate/shared";

import { expectContract } from "../../../test/contract.ts";
import { PROJECT_JOB_MOCK, PROJECT_MOCK, QUOTA_MOCK } from "./projects.mock.ts";
import { createProjectsService } from "./projects.service.ts";

describe("projects", () => {
  it("mocks match the contract", () => {
    expectContract(projectSchema, PROJECT_MOCK, (clone) => {
      clone["slug"] = "Not A Slug";
    });
    expectContract(quotaSchema, QUOTA_MOCK, (clone) => {
      clone["used_bytes"] = "many";
    });
    expectContract(jobSchema, PROJECT_JOB_MOCK, (clone) => {
      clone["status"] = "done";
    });
  });

  it("refuses a deletion whose confirm slug does not match", async () => {
    const service = createProjectsService();
    await expect(
      service.deleteProject("shop", "shpo", "01991f00-0000-7000-8000-000000000094")
    ).rejects.toThrow("confirm_slug does not match");
  });

  it("refuses a stale deletion plan", async () => {
    const service = createProjectsService();
    await expect(
      service.deleteProject("shop", "shop", "01991f00-0000-7000-8000-0000000000ff")
    ).rejects.toThrow("deletion plan is stale");
  });
});

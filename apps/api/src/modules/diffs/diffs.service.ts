import type { Diff, DiffRow, Job } from "@testate/shared";

import { conflict, notFound } from "../../lib/http/index.ts";
import { STATE_ID, STATE_INIT_ID } from "../../lib/mock/fixtures.ts";
import { PROJECT_JOB_MOCK } from "../projects/projects.mock.ts";
import { DIFF_MOCK, DIFF_ROWS_MOCK } from "./diffs.mock.ts";

export type DiffsService = {
  create(slug: string, baseStateId: string, live: boolean): Promise<{ diff: Diff; job: Job }>;
  list(slug: string): Promise<Diff[]>;
  get(slug: string, id: string): Promise<Diff>;
  rows(
    slug: string,
    id: string,
    op: "added" | "removed" | "changed" | undefined
  ): Promise<DiffRow[]>;
  remove(slug: string, id: string): Promise<void>;
};

const KNOWN_STATES = new Set([STATE_ID, STATE_INIT_ID]);

/** SCAFFOLD: one ready diff. The diffs card wires the merge over blobs (spec 20). */
export function createDiffsService(): DiffsService {
  const project = (slug: string): void => {
    if (slug !== "shop") throw notFound("project");
  };
  const find = (slug: string, id: string): Diff => {
    project(slug);
    if (id !== DIFF_MOCK.id) throw notFound("diff");
    return DIFF_MOCK;
  };
  return {
    async create(slug, baseStateId, live) {
      project(slug);
      if (!KNOWN_STATES.has(baseStateId)) throw notFound("state");
      const diff: Diff = {
        ...DIFF_MOCK,
        id: Bun.randomUUIDv7(),
        status: "running",
        target: live ? { live: true, snapshot_state_id: Bun.randomUUIDv7() } : DIFF_MOCK.target,
        adapters: [],
      };
      return {
        diff,
        job: {
          ...PROJECT_JOB_MOCK,
          kind: "diff",
          status: "queued",
          finished_at: null,
          result: null,
        },
      };
    },
    async list(slug) {
      project(slug);
      return [DIFF_MOCK];
    },
    async get(slug, id) {
      return find(slug, id);
    },
    async rows(slug, id, op) {
      find(slug, id);
      return op === undefined ? DIFF_ROWS_MOCK : DIFF_ROWS_MOCK.filter((row) => row.op === op);
    },
    async remove(slug, id) {
      const diff = find(slug, id);
      if (diff.status === "running") throw conflict("diff is still running");
    },
  };
}

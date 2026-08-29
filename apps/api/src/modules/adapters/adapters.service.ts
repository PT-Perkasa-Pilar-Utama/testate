import type { Adapter, AdapterDraft, AdapterMode, Job, ProbeResult } from "@testate/shared";

import { AppError, conflict, forbidden, notFound } from "../../lib/http/index.ts";
import { PROJECT_JOB_MOCK } from "../projects/projects.mock.ts";
import {
  ADAPTER_DELETION_PLAN_MOCK,
  ADAPTER_MOCK,
  MONGO_ADAPTER_MOCK,
  PROBE_MOCK,
  REST_ADAPTER_MOCK,
  STORAGE_ADAPTER_MOCK,
} from "./adapters.mock.ts";

export type AdaptersService = {
  list(slug: string): Promise<Adapter[]>;
  testDraft(draft: AdapterDraft): Promise<ProbeResult>;
  create(slug: string, draft: AdapterDraft): Promise<{ adapter: Adapter; init_job: Job | null }>;
  get(slug: string, id: string): Promise<Adapter>;
  update(slug: string, id: string): Promise<{ adapter: Adapter; init_job: Job | null }>;
  setMode(slug: string, id: string, mode: AdapterMode, actorRole: string): Promise<Adapter>;
  retest(slug: string, id: string): Promise<ProbeResult>;
  deletionPlan(slug: string, id: string): Promise<typeof ADAPTER_DELETION_PLAN_MOCK>;
  remove(slug: string, id: string, planId: string): Promise<Job>;
};

const ALL = [ADAPTER_MOCK, MONGO_ADAPTER_MOCK, STORAGE_ADAPTER_MOCK, REST_ADAPTER_MOCK];

/** SCAFFOLD: four adapters of the mock project. The adapters card wires probe, sealing, and the repository. */
export function createAdaptersService(): AdaptersService {
  const find = (slug: string, id: string): Adapter => {
    const adapter = ALL.find((item) => item.id === id);
    if (adapter === undefined) throw notFound("adapter");
    return adapter;
  };
  return {
    async list(_slug) {
      return ALL;
    },
    async testDraft(draft) {
      if (draft.engine === "mongodb")
        return {
          ...PROBE_MOCK,
          engine: "mongodb",
          dialect: "mongodb",
          tier: "document",
          floor: "6.0",
        };
      return PROBE_MOCK;
    },
    async create(slug, draft) {
      if (ALL.some((item) => item.name.toLowerCase() === draft.name.toLowerCase())) {
        throw conflict("adapter name is taken", { name: draft.name });
      }
      const initJob =
        draft.kind === "database"
          ? { ...PROJECT_JOB_MOCK, kind: "snapshot" as const, status: "queued" as const }
          : null;
      return {
        adapter: { ...ADAPTER_MOCK, name: draft.name, kind: draft.kind, engine: draft.engine },
        init_job: initJob,
      };
    },
    async get(slug, id) {
      return find(slug, id);
    },
    async update(slug, id) {
      return { adapter: find(slug, id), init_job: null };
    },
    async setMode(slug, id, mode, actorRole) {
      const adapter = find(slug, id);
      if (adapter.kind !== "database")
        throw new AppError("VALIDATION_ERROR", "only database adapters have a mode");
      if (mode === "sandbox" && actorRole !== "admin") throw forbidden("loosening requires admin");
      return { ...adapter, mode };
    },
    async retest(slug, id) {
      find(slug, id);
      return PROBE_MOCK;
    },
    async deletionPlan(slug, id) {
      find(slug, id);
      return ADAPTER_DELETION_PLAN_MOCK;
    },
    async remove(slug, id, planId) {
      find(slug, id);
      if (planId !== ADAPTER_DELETION_PLAN_MOCK.plan_id) throw conflict("deletion plan is stale");
      return {
        ...PROJECT_JOB_MOCK,
        kind: "adapter_delete",
        status: "queued",
        finished_at: null,
        result: null,
        adapter_ids: [id],
      };
    },
  };
}

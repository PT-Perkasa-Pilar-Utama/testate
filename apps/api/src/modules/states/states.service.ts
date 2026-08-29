import type {
  CreateStateInput,
  Job,
  State,
  StateTreeNode,
  UpdateStateInput,
} from "@testate/shared";

import { conflict, notFound } from "../../lib/http/index.ts";
import { PROJECT_JOB_MOCK } from "../projects/projects.mock.ts";
import {
  ARCHIVE_MANIFEST_MOCK,
  INIT_STATE_MOCK,
  MANIFEST_TABLES_MOCK,
  STASH_MOCK,
  STATE_MOCK,
  TREE_MOCK,
} from "./states.mock.ts";

export type StateDetail = State & {
  adapters: (State["adapters"][number] & { tables: typeof MANIFEST_TABLES_MOCK })[];
};

export type StatesService = {
  list(slug: string, includeStash: boolean): Promise<State[]>;
  tree(slug: string, includeStash: boolean): Promise<StateTreeNode[]>;
  snapshot(slug: string, input: CreateStateInput): Promise<{ state: State; job: Job }>;
  get(slug: string, idOrName: string): Promise<StateDetail>;
  update(slug: string, id: string, patch: UpdateStateInput): Promise<State>;
  remove(slug: string, id: string): Promise<Job>;
  archiveManifest(uploadId: string): Promise<typeof ARCHIVE_MANIFEST_MOCK>;
  importArchive(slug: string, name: string): Promise<Job>;
};

const ALL = [INIT_STATE_MOCK, STATE_MOCK, STASH_MOCK];

/**
 * SCAFFOLD: the routes still answer with three mock states. The data is real already: init snapshots
 * write `states`, `state_adapters`, and blobs through `states.snapshot.ts`; the states card lists them.
 */
export function createStatesService(): StatesService {
  const project = (slug: string): void => {
    if (slug !== "shop") throw notFound("project");
  };
  const find = (slug: string, idOrName: string): State => {
    project(slug);
    const state = ALL.find(
      (item) => item.id === idOrName || item.name.toLowerCase() === idOrName.toLowerCase()
    );
    if (state === undefined) throw notFound("state");
    return state;
  };
  return {
    async list(slug, includeStash) {
      project(slug);
      return includeStash ? ALL : ALL.filter((state) => state.kind !== "stash");
    },
    async tree(slug) {
      project(slug);
      return TREE_MOCK;
    },
    async snapshot(slug, input) {
      project(slug);
      if (ALL.some((state) => state.name.toLowerCase() === input.name.toLowerCase())) {
        throw conflict("state name is taken", { name: input.name });
      }
      const state: State = {
        ...STATE_MOCK,
        id: Bun.randomUUIDv7(),
        name: input.name,
        status: "creating",
        protected: false,
        tags: input.tags ?? [],
        notes: input.notes ?? null,
      };
      return {
        state,
        job: {
          ...PROJECT_JOB_MOCK,
          kind: "snapshot",
          status: "queued",
          finished_at: null,
          result: null,
        },
      };
    },
    async get(slug, idOrName) {
      const state = find(slug, idOrName);
      return {
        ...state,
        adapters: state.adapters.map((adapter) => ({ ...adapter, tables: MANIFEST_TABLES_MOCK })),
      };
    },
    async update(slug, id, patch) {
      const state = find(slug, id);
      if (state.kind === "init" && patch.protected === false)
        throw conflict("init states stay protected");
      const updated: State = { ...state };
      if (patch.name !== undefined) updated.name = patch.name;
      if (patch.protected !== undefined) updated.protected = patch.protected;
      return updated;
    },
    async remove(slug, id) {
      const state = find(slug, id);
      if (state.protected) throw conflict("state is protected", { state_id: id });
      return {
        ...PROJECT_JOB_MOCK,
        kind: "state_delete",
        status: "queued",
        finished_at: null,
        result: null,
      };
    },
    async archiveManifest() {
      return ARCHIVE_MANIFEST_MOCK;
    },
    async importArchive(slug) {
      project(slug);
      return {
        ...PROJECT_JOB_MOCK,
        kind: "archive_import",
        status: "queued",
        finished_at: null,
        result: null,
      };
    },
  };
}

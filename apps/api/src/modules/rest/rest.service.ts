import type { RestRequest, RestRun } from "@testate/shared";

import { AppError, conflict, notFound } from "../../lib/http/index.ts";
import { REST_ADAPTER_ID } from "../../lib/mock/fixtures.ts";
import { REST_REQUEST_MOCK, REST_RUN_MOCK } from "./rest.mock.ts";

export type RestService = {
  list(adapterId: string): Promise<RestRequest[]>;
  create(adapterId: string, name: string, path: string): Promise<RestRequest>;
  get(adapterId: string, id: string): Promise<RestRequest>;
  update(adapterId: string, id: string): Promise<RestRequest>;
  remove(adapterId: string, id: string, referencedByHook: boolean): Promise<void>;
  run(adapterId: string, id: string): Promise<RestRun>;
  runs(adapterId: string, id: string): Promise<RestRun[]>;
};

const PLACEHOLDER = /\{\{([a-z]+\.[a-z_]+)\}\}/g;
const KNOWN_PLACEHOLDERS = new Set(["project.slug", "state.name", "state.id", "job.id"]);

/** Rejects unknown placeholders; known ones expand at run time. */
export function checkPlaceholders(text: string): void {
  for (const match of text.matchAll(PLACEHOLDER)) {
    const name = match[1] ?? "";
    if (!KNOWN_PLACEHOLDERS.has(name))
      throw new AppError("VALIDATION_ERROR", `unknown placeholder {{${name}}}`);
  }
}

function requireRest(adapterId: string): void {
  if (adapterId !== REST_ADAPTER_ID)
    throw new AppError("ENGINE_UNSUPPORTED", "requests need a REST adapter", { reason: "tier" });
}

/** SCAFFOLD: one saved request with one run. The rest card wires the server-side HTTP client and netguard. */
export function createRestService(): RestService {
  const find = (adapterId: string, id: string): RestRequest => {
    requireRest(adapterId);
    if (id !== REST_REQUEST_MOCK.id) throw notFound("request");
    return REST_REQUEST_MOCK;
  };
  return {
    async list(adapterId) {
      requireRest(adapterId);
      return [REST_REQUEST_MOCK];
    },
    async create(adapterId, name, path) {
      requireRest(adapterId);
      checkPlaceholders(path);
      if (name.toLowerCase() === REST_REQUEST_MOCK.name)
        throw conflict("request name is taken", { name });
      return { ...REST_REQUEST_MOCK, id: Bun.randomUUIDv7(), name, path };
    },
    async get(adapterId, id) {
      return find(adapterId, id);
    },
    async update(adapterId, id) {
      return find(adapterId, id);
    },
    async remove(adapterId, id, referencedByHook) {
      find(adapterId, id);
      if (referencedByHook) throw conflict("a hook references this request");
    },
    async run(adapterId, id) {
      find(adapterId, id);
      return REST_RUN_MOCK;
    },
    async runs(adapterId, id) {
      find(adapterId, id);
      return [REST_RUN_MOCK];
    },
  };
}

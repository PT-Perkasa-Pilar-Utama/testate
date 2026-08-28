import type { Hook } from "@testate/shared";

import { AppError, notFound } from "../../lib/http/index.ts";
import { HOOK_MOCK } from "../rest/rest.mock.ts";

export type HooksService = {
  list(slug: string, trigger: string | undefined): Promise<Hook[]>;
  create(slug: string, trigger: Hook["trigger"], restRequestId: string): Promise<Hook>;
  update(slug: string, id: string): Promise<Hook>;
  remove(slug: string, id: string): Promise<void>;
  reorder(slug: string, trigger: Hook["trigger"], hookIds: string[]): Promise<Hook[]>;
};

/** SCAFFOLD: one hook. The hooks card wires ordered execution inside jobs. */
export function createHooksService(): HooksService {
  const project = (slug: string): void => {
    if (slug !== "shop") throw notFound("project");
  };
  return {
    async list(slug, trigger) {
      project(slug);
      return trigger === undefined || trigger === HOOK_MOCK.trigger ? [HOOK_MOCK] : [];
    },
    async create(slug, trigger, restRequestId) {
      project(slug);
      if (restRequestId !== HOOK_MOCK.request.id) throw notFound("request");
      return { ...HOOK_MOCK, id: Bun.randomUUIDv7(), trigger, position: 2 };
    },
    async update(slug, id) {
      project(slug);
      if (id !== HOOK_MOCK.id) throw notFound("hook");
      return HOOK_MOCK;
    },
    async remove(slug, id) {
      project(slug);
      if (id !== HOOK_MOCK.id) throw notFound("hook");
    },
    async reorder(slug, trigger, hookIds) {
      project(slug);
      const expected = trigger === HOOK_MOCK.trigger ? [HOOK_MOCK.id] : [];
      const same =
        hookIds.length === expected.length && hookIds.every((id, index) => id === expected[index]);
      if (!same)
        throw new AppError(
          "VALIDATION_ERROR",
          "hook_ids must list every hook of the trigger exactly once"
        );
      return expected.length === 0 ? [] : [HOOK_MOCK];
    },
  };
}

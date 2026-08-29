import { createSignal } from "solid-js";
import type { Adapter, Hook, JsonObject, RestRequest } from "@testate/shared";

import { attempt } from "@/components/toast.tsx";
import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { adapterModel } from "../adapter/adapter.model.ts";
import { adaptersModel } from "../adapters/adapters.model.ts";
import { hooksModel } from "./hooks.model.ts";

export type HookDraft = {
  trigger: Hook["trigger"];
  adapter_id: string;
  rest_request_id: string;
  fail_policy: "abort" | "continue";
};

export type HooksPresenter = Refreshable<Hook[]> & {
  restAdapters: Refreshable<Adapter[]>;
  requests: Refreshable<RestRequest[]>;
  creating: () => boolean;
  draft: () => HookDraft;
  error: () => string | null;
  openCreate: () => void;
  close: () => void;
  setDraft: (patch: Partial<HookDraft>) => void;
  create: () => Promise<void>;
  setEnabled: (hook: Hook, enabled: boolean) => Promise<void>;
  setPolicy: (hook: Hook, policy: "abort" | "continue") => Promise<void>;
  move: (hook: Hook, direction: -1 | 1) => Promise<void>;
  remove: (hook: Hook) => Promise<void>;
};

const EMPTY: HookDraft = {
  trigger: "after_checkout",
  adapter_id: "",
  rest_request_id: "",
  fail_policy: "continue",
};

export function toCreateBody(draft: HookDraft): JsonObject {
  return {
    trigger: draft.trigger,
    rest_request_id: draft.rest_request_id,
    fail_policy: draft.fail_policy,
  };
}

/** The ids of one trigger in position order with `hook` moved one step; unchanged at either end. */
export function movedOrder(hooks: Hook[], hook: Hook, direction: -1 | 1): string[] {
  const ids = hooks
    .filter((other) => other.trigger === hook.trigger)
    .sort((a, b) => a.position - b.position)
    .map((other) => other.id);
  const from = ids.indexOf(hook.id);
  const to = from + direction;
  if (from === -1 || to < 0 || to >= ids.length) return ids;
  const swapped = [...ids];
  swapped[from] = ids[to] ?? hook.id;
  swapped[to] = hook.id;
  return swapped;
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : "request failed";
}

export function createHooksPresenter(slug: () => string): HooksPresenter {
  const hooks = createRefreshable(() => hooksModel.list(slug()));
  const restAdapters = createRefreshable(async () =>
    (await adaptersModel.list(slug())).filter((adapter) => adapter.kind === "rest")
  );
  const [creating, setCreating] = createSignal(false);
  const [draft, setDraftSignal] = createSignal<HookDraft>(EMPTY);
  const [error, setError] = createSignal<string | null>(null);
  const requests = createRefreshable(async () =>
    draft().adapter_id === "" ? [] : adapterModel.requests(slug(), draft().adapter_id)
  );
  const patch = (hook: Hook, body: JsonObject): Promise<void> => {
    const staticSlug = slug();
    return attempt(async () => {
      await hooksModel.update(staticSlug, hook.id, body);
      hooks.refresh();
    });
  };
  return {
    ...hooks,
    restAdapters,
    requests,
    creating,
    draft,
    error,
    openCreate: () => {
      setDraftSignal(EMPTY);
      setError(null);
      setCreating(true);
    },
    close: () => {
      setCreating(false);
      setError(null);
    },
    setDraft: (next) => setDraftSignal((current) => ({ ...current, ...next })),
    create: async () => {
      const staticSlug = slug();
      const staticBody = toCreateBody(draft());
      setError(null);
      try {
        await hooksModel.create(staticSlug, staticBody);
        setCreating(false);
        hooks.refresh();
      } catch (cause: unknown) {
        setError(messageOf(cause));
      }
    },
    setEnabled: (hook, enabled) => patch(hook, { enabled }),
    setPolicy: (hook, policy) => patch(hook, { fail_policy: policy }),
    move: (hook, direction) => {
      const staticSlug = slug();
      const staticIds = movedOrder(hooks.value(), hook, direction);
      return attempt(async () => {
        await hooksModel.reorder(staticSlug, { trigger: hook.trigger, hook_ids: staticIds });
        hooks.refresh();
      });
    },
    remove: (hook) => {
      const staticSlug = slug();
      return attempt(async () => {
        await hooksModel.remove(staticSlug, hook.id);
        hooks.refresh();
      });
    },
  };
}

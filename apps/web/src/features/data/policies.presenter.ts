import { createSignal } from "solid-js";
import type { ColumnPolicy, Introspection, JsonObject } from "@testate/shared";
import { maskSchema } from "@testate/shared";
import type * as v from "valibot";

import { attempt, showToast } from "@/lib/toast.ts";
import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { adapterModel } from "../adapter/adapter.model.ts";
import { FUNCTION_OPTIONS } from "./editing.presenter.ts";
import type { FunctionName } from "./editing.presenter.ts";
import { qualifiedName } from "./grid.presenter.ts";
import { policiesModel } from "./policies.model.ts";

export type Mask = v.InferOutput<typeof maskSchema>;
export const NONE = "none";
export const FUNCTION_CHOICES = [
  { value: NONE, label: "no function" },
  ...FUNCTION_OPTIONS,
] as const;
export const MASK_CHOICES = [
  { value: NONE, label: "no mask" },
  ...maskSchema.options.map((mask) => ({ value: mask, label: mask })),
] as const;

export type PolicyDraft = {
  table: string;
  column: string;
  fn: FunctionName | typeof NONE;
  mask: Mask | typeof NONE;
  display: boolean;
};

export type PoliciesPresenter = {
  schema: Refreshable<Introspection>;
  policies: Refreshable<ColumnPolicy[]>;
  draft: () => PolicyDraft | null;
  open: (table: string, column: string) => void;
  close: () => void;
  setDraft: (patch: Partial<PolicyDraft>) => void;
  save: () => Promise<void>;
  remove: (policy: ColumnPolicy) => Promise<void>;
  setLock: (policy: ColumnPolicy, locked: boolean) => Promise<void>;
};

/** The PUT body (06 §6.12): `none` becomes null; hashes with no params keep the server defaults. */
export function policyBody(draft: PolicyDraft): JsonObject {
  return {
    required_function: draft.fn === NONE ? null : { name: draft.fn },
    mask: draft.mask === NONE ? null : draft.mask,
    display: draft.display,
  };
}

export function createPoliciesPresenter(slug: () => string, id: () => string): PoliciesPresenter {
  const schema = createRefreshable(() => adapterModel.schema(slug(), id()));
  const policies = createRefreshable(() => policiesModel.list(slug(), id()));
  const [draft, setDraftSignal] = createSignal<PolicyDraft | null>(null);
  return {
    schema,
    policies,
    draft,
    open: (table, column) => {
      const existing = policies
        .value()
        .find((policy) => policy.table === table && policy.column === column);
      setDraftSignal({
        table,
        column,
        fn: existing?.required_function?.name ?? NONE,
        mask: existing?.mask ?? NONE,
        display: existing?.display ?? false,
      });
    },
    close: () => setDraftSignal(null),
    setDraft: (patch) =>
      setDraftSignal((current) => (current === null ? null : { ...current, ...patch })),
    save: () => {
      const staticSlug = slug();
      const staticId = id();
      const staticDraft = draft();
      if (staticDraft === null) return Promise.resolve();
      return attempt(async () => {
        await policiesModel.upsert(
          staticSlug,
          staticId,
          staticDraft.table,
          staticDraft.column,
          policyBody(staticDraft)
        );
        setDraftSignal(null);
        policies.refresh();
        showToast("Policy saved", "success");
      });
    },
    remove: (policy) => {
      const staticSlug = slug();
      const staticId = id();
      return attempt(async () => {
        await policiesModel.remove(staticSlug, staticId, policy.table, policy.column);
        policies.refresh();
      });
    },
    setLock: (policy, locked) => {
      const staticSlug = slug();
      const staticId = id();
      return attempt(async () => {
        await policiesModel.setLock(staticSlug, staticId, policy.table, policy.column, locked);
        policies.refresh();
      });
    },
  };
}

export { qualifiedName };

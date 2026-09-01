import { createSignal } from "solid-js";
import type { ColumnPolicy, Introspection, JsonObject, PolicyFormInput } from "@testate/shared";
import { policyFunctionChoiceSchema, policyMaskChoiceSchema } from "@testate/shared";

import { humanMessage } from "@/lib/api-error.ts";
import { attempt, showToast } from "@/lib/toast.ts";
import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { adapterModel } from "../adapter/adapter.model.ts";
import { qualifiedName } from "./grid.presenter.ts";
import { policiesModel } from "./policies.model.ts";

export const NONE = "none";
export const FUNCTION_CHOICES = policyFunctionChoiceSchema.options.map((value) => ({
  value,
  label: value === NONE ? "no function" : value,
}));
export const MASK_CHOICES = policyMaskChoiceSchema.options.map((value) => ({
  value,
  label: value === NONE ? "no mask" : value,
}));

export type PolicyDraft = { table: string; column: string } & PolicyFormInput;

export type PoliciesPresenter = {
  schema: Refreshable<Introspection>;
  policies: Refreshable<ColumnPolicy[]>;
  draft: () => PolicyDraft | null;
  error: () => string | null;
  open: (table: string, column: string) => void;
  close: () => void;
  save: (input: PolicyFormInput) => Promise<void>;
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

function messageOf(cause: unknown): string {
  return humanMessage(cause, "Could not save that policy.");
}

export function createPoliciesPresenter(slug: () => string, id: () => string): PoliciesPresenter {
  const schema = createRefreshable(() => adapterModel.schema(slug(), id()));
  const policies = createRefreshable(() => policiesModel.list(slug(), id()));
  const [draft, setDraftSignal] = createSignal<PolicyDraft | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const close = (): void => {
    setDraftSignal(null);
    setError(null);
  };
  /** The dialog's submit keeps its error in the form instead of a toast. */
  const inForm = async (task: () => Promise<void>): Promise<void> => {
    setError(null);
    try {
      await task();
    } catch (cause: unknown) {
      setError(messageOf(cause));
    }
  };
  return {
    schema,
    policies,
    draft,
    error,
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
    close,
    save: (input) => {
      const staticSlug = slug();
      const staticId = id();
      const staticTarget = draft();
      if (staticTarget === null) return Promise.resolve();
      return inForm(async () => {
        await policiesModel.upsert(
          staticSlug,
          staticId,
          staticTarget.table,
          staticTarget.column,
          policyBody({ ...staticTarget, ...input })
        );
        close();
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

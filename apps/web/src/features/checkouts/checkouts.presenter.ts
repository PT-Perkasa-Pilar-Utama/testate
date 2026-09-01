import { createSignal } from "solid-js";
import * as v from "valibot";
import type { Checkout, Counters } from "@testate/shared";

import { attempt, showToast } from "@/lib/toast.ts";
import { createPaged } from "@/lib/async.ts";
import { createTableControls } from "@/lib/table.ts";
import type { TableControls } from "@/lib/table.ts";
import type { Paged } from "@/lib/async.ts";
import { CHECKOUT_PURPOSE_LABEL, JOB_STATUS_LABEL } from "@/lib/labels.ts";
import { followJob } from "@/lib/sse.ts";
import { checkoutsModel } from "./checkouts.model.ts";

export type CheckoutSort = "state" | "status" | "actor" | "created_at";

/** Status and purpose: the two extra filters `/checkouts` takes beyond sort, search and dates. */
export type CheckoutFilters = {
  status: Checkout["status"] | "";
  purpose: Checkout["purpose"] | "";
};
const EMPTY_FILTERS: CheckoutFilters = { status: "", purpose: "" };

// checkoutSchema's status picklist is narrower than a job's: no "queued", a checkout is only ever
// created once its job has started. Neither list rides a standalone export, so it is hand-typed
// here; `satisfies` fails the build if it drifts from `Checkout["status"]`.
const CHECKOUT_STATUSES = [
  "running",
  "succeeded",
  "partial",
  "failed",
  "cancelled",
  "interrupted",
] as const satisfies readonly Checkout["status"][];
const CHECKOUT_PURPOSES = [
  "checkout",
  "return_to_init",
] as const satisfies readonly Checkout["purpose"][];

export const CHECKOUT_STATUS_FILTER_OPTIONS: { value: Checkout["status"] | ""; label: string }[] = [
  { value: "", label: "All statuses" },
  ...CHECKOUT_STATUSES.map((value) => ({ value, label: JOB_STATUS_LABEL[value] })),
];
export const CHECKOUT_PURPOSE_FILTER_OPTIONS: { value: Checkout["purpose"] | ""; label: string }[] =
  [
    { value: "", label: "All purposes" },
    ...CHECKOUT_PURPOSES.map((value) => {
      const phrase = CHECKOUT_PURPOSE_LABEL[value];
      // CHECKOUT_PURPOSE_LABEL reads mid-sentence ("checked out"); a standalone filter option
      // wants sentence case like every other label in this panel.
      return { value, label: `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}` };
    }),
  ];

export type CheckoutsPresenter = Paged<Checkout> & {
  table: TableControls<CheckoutSort> & { rows: () => Checkout[] };
  filters: () => CheckoutFilters;
  setFilters: (patch: Partial<CheckoutFilters>) => void;
  detail: () => Checkout | null;
  counters: () => { checkout: Checkout; result: Counters } | null;
  openDetail: (checkout: Checkout) => void;
  openCounters: (checkout: Checkout) => Promise<void>;
  close: () => void;
  retry: (checkout: Checkout) => Promise<void>;
  terminate: (checkout: Checkout, adapter: Checkout["adapters"][number]) => Promise<void>;
  repair: () => Promise<void>;
};

/** Mirrors the API: only these per-adapter results can be retried (13 §13.4). */
const RETRIABLE = new Set(["rolled_back", "unknown", "counters_failed", "pending"]);

export function retriable(checkout: Checkout): boolean {
  return (
    checkout.status !== "running" &&
    checkout.adapters.some((adapter) => RETRIABLE.has(adapter.result))
  );
}

/** "12 ok · 1 failed" over every adapter's counters. */
export function countersSummary(counters: Counters): string {
  const all = counters.adapters.flatMap((adapter) => adapter.counters);
  const failed = all.filter((counter) => !counter.ok).length;
  return `${all.length - failed} ok · ${failed} failed`;
}

const sessionsSchema = v.array(v.string());

/** The session ids the engine named as blockers on a lock timeout, or none (story 85). */
export function blockingSessions(adapter: Checkout["adapters"][number]): string[] {
  const parsed = v.safeParse(sessionsSchema, adapter.error?.details?.["blocking_sessions"]);
  return parsed.success ? parsed.output : [];
}

/** The adapters this checkout is stuck behind a lock on — Terminate blockers acts on these. */
export function blockedAdapters(checkout: Checkout): Checkout["adapters"] {
  return checkout.adapters.filter((adapter) => blockingSessions(adapter).length > 0);
}

/** Why "Retry" is dead, next to the button rather than left for the row to explain by itself. */
export function retryBlockedReason(checkout: Checkout): string | undefined {
  if (checkout.status === "running") return "Wait for this restore to finish.";
  if (!retriable(checkout)) return "Nothing to retry — every database finished cleanly.";
  return undefined;
}

/**
 * The one line a row has room for on a checkout that did not simply succeed.
 *
 * The engine's own words on purpose: a restore that failed on a lock, a constraint or a missing
 * privilege is something an operator has to read exactly, and this screen exists to be read that
 * way. Not a case for `humanMessage`.
 */
export function outcomeLine(checkout: Checkout): string {
  const failed = checkout.adapters.find((adapter) => adapter.error !== null);
  if (failed?.error) return `${failed.name}: ${failed.error.message}`;
  return checkout.adapters.map(skippedSummary).find((line) => line !== "") ?? "";
}

/** True when any counter failed to reset. `"…failed".endsWith("0 failed")` lies for 10, 20, 30. */
export function hasFailure(result: Counters): boolean {
  return result.adapters.some((adapter) => adapter.counters.some((counter) => !counter.ok));
}

/** "3 tables, 2 columns skipped · 1 column defaulted" or "" when a restore was complete. */
export function skippedSummary(adapter: Checkout["adapters"][number]): string {
  const parts: string[] = [];
  if (adapter.skipped_tables.length > 0) parts.push(`${adapter.skipped_tables.length} tables`);
  if (adapter.skipped_columns.length > 0) parts.push(`${adapter.skipped_columns.length} columns`);
  const skipped = parts.length === 0 ? "" : `${parts.join(", ")} skipped`;
  const defaulted =
    adapter.defaulted_columns.length === 0
      ? ""
      : `${adapter.defaulted_columns.length} columns defaulted`;
  return [skipped, defaulted].filter((part) => part !== "").join(" · ");
}

export function createCheckoutsPresenter(
  slug: () => string,
  onChanged: () => void = () => undefined
): CheckoutsPresenter {
  const controls = createTableControls<CheckoutSort>();
  const [filters, setFiltersSignal] = createSignal<CheckoutFilters>(EMPTY_FILTERS);
  const checkouts = createPaged(
    (cursor) => checkoutsModel.page(slug(), cursor, controls.params(), filters()),
    () => `${controls.key()}|${filters().status}|${filters().purpose}`
  );
  const table: TableControls<CheckoutSort> & { rows: () => Checkout[] } = {
    ...controls,
    rows: checkouts.value,
  };
  const [detail, setDetail] = createSignal<Checkout | null>(null);
  const [counters, setCounters] = createSignal<{ checkout: Checkout; result: Counters } | null>(
    null
  );
  const refreshAll = (): void => {
    checkouts.refresh();
    onChanged();
  };
  return {
    ...checkouts,
    table,
    filters,
    setFilters: (patch) => setFiltersSignal((current) => ({ ...current, ...patch })),
    detail,
    counters,
    openDetail: (checkout) => setDetail(checkout),
    openCounters: (checkout) => {
      const staticSlug = slug();
      return attempt(async () => {
        setCounters({ checkout, result: await checkoutsModel.counters(staticSlug, checkout.id) });
      });
    },
    close: () => {
      setDetail(null);
      setCounters(null);
    },
    retry: (checkout) => {
      const staticSlug = slug();
      return attempt(async () => {
        const { job } = await checkoutsModel.retry(staticSlug, checkout.id);
        showToast(`Retrying ${checkout.state.name} on the failed adapters`, "info");
        refreshAll();
        followJob(job, refreshAll);
      });
    },
    terminate: (checkout, adapter) => {
      const staticSlug = slug();
      const staticSessions = blockingSessions(adapter);
      return attempt(async () => {
        const result = await checkoutsModel.terminateBlockers(staticSlug, checkout.id, {
          adapter_id: adapter.adapter_id,
          session_ids: staticSessions,
        });
        showToast(
          `Terminated ${result.terminated.length} session(s)${result.failed.length === 0 ? "" : `; ${result.failed.length} refused`}`,
          result.failed.length === 0 ? "success" : "error"
        );
        checkouts.refresh();
      });
    },
    repair: () => {
      const staticSlug = slug();
      const staticTarget = counters();
      if (staticTarget === null) return Promise.resolve();
      return attempt(async () => {
        const result = await checkoutsModel.repairCounters(staticSlug, staticTarget.checkout.id);
        setCounters({ checkout: staticTarget.checkout, result });
        showToast(`Counters: ${countersSummary(result)}`, "success");
        refreshAll();
      });
    },
  };
}

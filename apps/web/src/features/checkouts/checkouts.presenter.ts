import { createSignal } from "solid-js";
import * as v from "valibot";
import type { Checkout, Counters } from "@testate/shared";

import { attempt, showToast } from "@/components/toast.tsx";
import { createPaged } from "@/lib/async.ts";
import type { Paged } from "@/lib/async.ts";
import { followJob } from "@/lib/sse.ts";
import { checkoutsModel } from "./checkouts.model.ts";

export type CheckoutsPresenter = Paged<Checkout> & {
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
  const checkouts = createPaged((cursor) => checkoutsModel.page(slug(), cursor));
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

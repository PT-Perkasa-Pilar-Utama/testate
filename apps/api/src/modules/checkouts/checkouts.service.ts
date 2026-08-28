import type { Checkout, CheckoutRequest, Job, Preflight } from "@testate/shared";

import { AppError, conflict, notFound } from "../../lib/http/index.ts";
import { PROJECT_JOB_MOCK } from "../projects/projects.mock.ts";
import { CHECKOUT_MOCK, PREFLIGHT_MOCK } from "./checkouts.mock.ts";

export type CheckoutsService = {
  preflight(slug: string, input: CheckoutRequest): Promise<Preflight>;
  create(slug: string, input: CheckoutRequest): Promise<{ checkout: Checkout; job: Job }>;
  list(slug: string): Promise<Checkout[]>;
  get(slug: string, id: string): Promise<Checkout>;
  retry(slug: string, id: string): Promise<{ checkout: Checkout; job: Job }>;
  terminateBlockers(
    slug: string,
    id: string,
    sessionIds: string[]
  ): Promise<{ terminated: string[]; failed: string[] }>;
  counters(
    slug: string,
    id: string
  ): Promise<{ adapters: { adapter_id: string; counters: { name: string; ok: boolean }[] }[] }>;
  repairCounters(
    slug: string,
    id: string
  ): Promise<{ adapters: { adapter_id: string; counters: { name: string; ok: boolean }[] }[] }>;
};

/** SCAFFOLD: one partial checkout. The checkouts card wires drift, strategy, and the engine (spec 13). */
export function createCheckoutsService(): CheckoutsService {
  const project = (slug: string): void => {
    if (slug !== "shop") throw notFound("project");
  };
  const find = (slug: string, id: string): Checkout => {
    project(slug);
    if (id !== CHECKOUT_MOCK.id) throw notFound("checkout");
    return CHECKOUT_MOCK;
  };
  const resolveState = (input: CheckoutRequest): void => {
    const known =
      input.state_id === CHECKOUT_MOCK.state.id ||
      input.state_name?.toLowerCase() === CHECKOUT_MOCK.state.name;
    if (!known) throw notFound("state");
  };
  const queued = (kind: Job["kind"]): Job => ({
    ...PROJECT_JOB_MOCK,
    kind,
    status: "queued",
    finished_at: null,
    result: null,
  });
  return {
    async preflight(slug, input) {
      project(slug);
      resolveState(input);
      return PREFLIGHT_MOCK;
    },
    async create(slug, input) {
      project(slug);
      resolveState(input);
      if (
        !input.force &&
        PREFLIGHT_MOCK.adapters.some((adapter) => adapter.drift?.changed === true)
      ) {
        throw new AppError("SCHEMA_DRIFT", "live schema differs from the state", {
          tables: [],
          columns: [{ table: "public.orders", column: "channel" }],
        });
      }
      return {
        checkout: { ...CHECKOUT_MOCK, force: input.force, status: "running", finished_at: null },
        job: queued("checkout"),
      };
    },
    async list(slug) {
      project(slug);
      return [CHECKOUT_MOCK];
    },
    async get(slug, id) {
      return find(slug, id);
    },
    async retry(slug, id) {
      const checkout = find(slug, id);
      if (checkout.status === "running") throw conflict("checkout is still running");
      if (
        !checkout.adapters.some(
          (adapter) => adapter.result !== "restored" && adapter.result !== "skipped"
        )
      ) {
        throw conflict("nothing to retry");
      }
      return {
        checkout: { ...checkout, status: "running", finished_at: null },
        job: queued("checkout"),
      };
    },
    async terminateBlockers(slug, id, sessionIds) {
      find(slug, id);
      return { terminated: sessionIds, failed: [] };
    },
    async counters(slug, id) {
      find(slug, id);
      return {
        adapters: [
          {
            adapter_id: CHECKOUT_MOCK.adapters[0]?.adapter_id ?? "",
            counters: [{ name: "orders_id_seq", ok: true }],
          },
        ],
      };
    },
    async repairCounters(slug, id) {
      find(slug, id);
      return {
        adapters: [
          {
            adapter_id: CHECKOUT_MOCK.adapters[0]?.adapter_id ?? "",
            counters: [{ name: "orders_id_seq", ok: true }],
          },
        ],
      };
    },
  };
}

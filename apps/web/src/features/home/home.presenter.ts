import type { AuditRow, HealthAdmin, Job, Project } from "@testate/shared";

import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { hasRole } from "@/lib/session.ts";
import { auditModel } from "../audit/audit.model.ts";
import { jobsModel } from "../jobs/jobs.model.ts";
import { projectsModel } from "../projects/projects.model.ts";
import { settingsModel } from "../settings/settings.model.ts";
import { tokensModel } from "../tokens/tokens.model.ts";
import { usersModel } from "../users/users.model.ts";
import { since } from "./home.format.ts";

export type Counted<T> = { rows: T[]; total: number };

export type HomePresenter = {
  projects: Refreshable<Project[]>;
  running: Refreshable<Counted<Job>>;
  failed: Refreshable<Counted<Job>>;
  /** Null for a Guest, who cannot check out, and for an Admin, whose card is Users. */
  checkouts: Refreshable<number> | null;
  /** Admin only; null for everyone else, so the card is simply not there. */
  health: Refreshable<HealthAdmin> | null;
  people: Refreshable<{ users: number; tokens: number }> | null;
  activity: Refreshable<AuditRow[]> | null;
};

const NEWEST: Parameters<typeof jobsModel.page>[1] = { sort: "created_at", order: "desc" };

/** The same list, narrowed to the last day; `created_from` is what the jobs query already takes. */
function lastDay(from: string): Parameters<typeof jobsModel.page>[1] {
  return { ...NEWEST, created_from: from };
}

/**
 * What the home page asks for, and nothing a role would be refused.
 *
 * The refreshables are built here rather than inside the view because a memo computes when it is
 * created: building the admin ones for a Guest would fire the request before anything could decide
 * not to render it. `/users` and `/tokens` would answer 403, and `/health` is worse: it answers
 * 200 with the public shape and the parse throws.
 */
export function createHomePresenter(now: () => Date): HomePresenter {
  const admin = hasRole("admin");
  // Whoever sees the card. A memo fetches when it is built, so an admin building one would ask
  // /jobs for a number its own Stats row replaces with Users and Tokens.
  const tester = hasRole("qa") && !admin;
  const window = (): string => since(now());
  // One status per call: the API reads a single `status`, so a second one would be a second call.
  const byStatus = async (
    status: "running" | "failed",
    params: Parameters<typeof jobsModel.page>[1]
  ): Promise<Counted<Job>> => {
    const page = await jobsModel.page(undefined, params, { kind: "", status });
    // ponytail: `total` is null on an endpoint that does not count, and the page size stands in.
    // /jobs does count, so this only ever fires if that changes; swap for a count call if it does.
    return { rows: page.data, total: page.total ?? page.data.length };
  };
  const checkoutsToday = async (): Promise<number> => {
    const page = await jobsModel.page(undefined, lastDay(window()), {
      kind: "checkout",
      status: "",
    });
    return page.total ?? page.data.length;
  };
  const countPeople = async (): Promise<{ users: number; tokens: number }> => {
    const users = await usersModel.list();
    const tokens = await tokensModel.page(undefined, { sort: "name", order: "asc" }, "", "");
    return { users: users.length, tokens: tokens.total ?? tokens.data.length };
  };
  return {
    projects: createRefreshable(() => projectsModel.list()),
    running: createRefreshable(() => byStatus("running", NEWEST)),
    failed: createRefreshable(() => byStatus("failed", lastDay(window()))),
    checkouts: tester ? createRefreshable(() => checkoutsToday()) : null,
    health: admin ? createRefreshable(() => settingsModel.health()) : null,
    people: admin ? createRefreshable(() => countPeople()) : null,
    activity: admin ? createRefreshable(() => auditModel.list()) : null,
  };
}

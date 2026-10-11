import { onCleanup } from "solid-js";

import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { projectsModel } from "../projects/projects.model.ts";
import { monitorModel } from "./monitor.model.ts";
import { overviewOf } from "./monitor.overview.ts";
import type { Overview } from "./monitor.overview.ts";

const REFRESH_MS = 30_000;

export type MonitorOverviewPresenter = { overview: Refreshable<Overview> };

/** ponytail: one request per project for its newest reading; an instance-wide endpoint is the
 * upgrade once a deployment holds more projects than a page of requests should cost. */
export function createMonitorOverviewPresenter(): MonitorOverviewPresenter {
  const overview = createRefreshable(async (): Promise<Overview> => {
    const projects = await projectsModel.list();
    const latest = await Promise.all(
      projects.map(async (project) => ({
        project,
        reading: await monitorModel.latest(project.slug),
      }))
    );
    return overviewOf(latest);
  });
  const timer = setInterval(() => overview.refresh(), REFRESH_MS);
  onCleanup(() => clearInterval(timer));
  return { overview };
}

import type { HealthAdmin, Job, Project } from "@testate/shared";

/** The three words a health check answers with; the payload types each one the same way. */
type CheckStatus = HealthAdmin["checks"]["metadata_db"]["status"];

/** A day back from now, as a full timestamp. */
export function since(now: Date, hours = 24): string {
  return new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
}

/**
 * The greeting, by the clock on the reader's own machine.
 *
 * Not a stat, and deliberately the only thing on the page that is about the person rather than the
 * instance: a dashboard that opens with a number nobody asked for reads like a report.
 */
export function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  return hour < 18 ? "Good afternoon" : "Good evening";
}

/** The project a job belongs to, by id, for a row that has room for a name and not an id. */
export function projectOf(projects: readonly Project[], job: Job): string {
  return projects.find((project) => project.id === job.project_id)?.name ?? "";
}

export type Attention = { label: string; tone: "warning" | "error" };

/**
 * What is wrong right now, worst first, and nothing at all when nothing is.
 *
 * A card that says "0 failed, all checks green" is a card that trains people to skip it. This
 * returns an empty list and the view says one quiet line instead.
 */
export function attention(failed: number, health: HealthAdmin | null): Attention[] {
  const found: Attention[] = [];
  if (failed > 0) {
    found.push({
      label: `${failed} job${failed === 1 ? "" : "s"} failed in the last day`,
      tone: "error",
    });
  }
  for (const [name, check] of Object.entries(health?.checks ?? {})) {
    const status: CheckStatus = check.status;
    if (status === "ok") continue;
    found.push({ label: `${NAMES.get(name) ?? name} is ${status}`, tone: statusTone(status) });
  }
  return found;
}

function statusTone(status: CheckStatus): Attention["tone"] {
  return status === "down" ? "error" : "warning";
}

/** The words a person uses for each check, rather than the key the health payload ships. */
const NAMES = new Map([
  ["metadata_db", "The metadata database"],
  ["data_dir", "The data directory"],
  ["snapshot_store", "The snapshot store"],
  ["dispatcher", "The job runner"],
  ["log_sink", "The log sink"],
  ["sealed_keys", "The sealed keys"],
]);

/** `PT2H14M` reads as nobody's uptime; this is what an operator says out loud. */
export function uptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  if (days > 0) return `${days} day${days === 1 ? "" : "s"}`;
  const hours = Math.floor(seconds / 3600);
  if (hours > 0) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const minutes = Math.max(1, Math.floor(seconds / 60));
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

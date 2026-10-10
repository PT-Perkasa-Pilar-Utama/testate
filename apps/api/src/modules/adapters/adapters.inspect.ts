import type { Actor, AdapterDraft, AdapterKind, AdapterMode, Project } from "@testate/shared";

import { AppError, forbidden } from "../../lib/http/index.ts";

type Kind = Pick<Project, "kind">;

/**
 * The mode a new adapter gets (#56, Q5). In Inspect it is always `read_only`, and a request that
 * asks for `sandbox` there is refused rather than quietly changed. Elsewhere a database defaults
 * to sandbox and a file store to read-only, as before.
 */
export function modeOnCreate(
  project: Kind,
  draft: Pick<AdapterDraft, "kind" | "mode"> & { engine?: AdapterDraft["engine"] }
): AdapterMode {
  // Pushed logs are records Testate keeps, and Inspect keeps none of its own (Q10).
  if (draft.engine === "ingest" && project.kind === "inspect")
    throw new AppError("PROJECT_READ_ONLY", "Inspect stores no pushed logs; use a project.", {
      engine: draft.engine,
    });
  if (draft.kind === "logs") return logsMode(draft.mode);
  if (project.kind === "inspect") {
    if (draft.mode === "sandbox") {
      throw new AppError("PROJECT_READ_ONLY", "Every adapter in Inspect is read-only.", {
        mode: draft.mode,
      });
    }
    return "read_only";
  }
  return draft.mode ?? (draft.kind === "database" ? "sandbox" : "read_only");
}

/** A Logs adapter only reads: its port has no write half, so `sandbox` would promise nothing (Q3). */
function logsMode(asked: AdapterMode | undefined): AdapterMode {
  if (asked === "sandbox") throw logsOnlyRead();
  return "read_only";
}

function logsOnlyRead(): AppError {
  return new AppError("ENGINE_UNSUPPORTED", "A Logs adapter only reads; it has no write mode.", {
    reason: "tier",
  });
}

/**
 * The read-only mode is what Inspect guarantees, so nobody switches it, admins included; and a
 * Logs adapter has no other mode to switch to.
 */
export function assertModeChangeable(project: Kind, adapterKind: AdapterKind): void {
  if (adapterKind === "logs") throw logsOnlyRead();
  if (project.kind === "inspect") {
    throw new AppError("PROJECT_READ_ONLY", "Every adapter in Inspect stays read-only.");
  }
}

/**
 * In Inspect an adapter is one person's connection for their agent, so only whoever added it, or
 * an admin, may edit it, delete it or change its column policies (#56, Q3b). One with no recorded
 * creator is an admin's. Regular projects record the creator but do not enforce this (Q3c).
 */
export function assertMayManage<T extends { created_by: string | null }>(
  project: Kind | null,
  adapter: T,
  actor: Actor
): T {
  if (project?.kind !== "inspect" || actor.role === "admin") return adapter;
  if (actor.kind === "user" && adapter.created_by === actor.id) return adapter;
  throw forbidden("not_adapter_owner");
}

/** Nothing in Inspect is ever restored, so an adapter there takes no init snapshot (Q5). */
export function takesInit(project: Kind): boolean {
  return project.kind !== "inspect";
}

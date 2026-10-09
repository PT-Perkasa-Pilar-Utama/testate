import type { Actor, AdapterDraft, AdapterMode, Project } from "@testate/shared";

import { AppError, forbidden } from "../../lib/http/index.ts";

type Kind = Pick<Project, "kind">;

/**
 * The mode a new adapter gets (#56, Q5). In Inspect it is always `read_only`, and a request that
 * asks for `sandbox` there is refused rather than quietly changed. Elsewhere a database defaults
 * to sandbox and a file store to read-only, as before.
 */
export function modeOnCreate(
  project: Kind,
  draft: Pick<AdapterDraft, "kind" | "mode">
): AdapterMode {
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

/** The read-only mode is what Inspect guarantees, so nobody switches it, admins included. */
export function assertModeChangeable(project: Kind): void {
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

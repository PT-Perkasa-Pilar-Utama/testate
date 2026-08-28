import { createSignal } from "solid-js";
import type { Actor, Me, Role } from "@testate/shared";
import { meSchema } from "@testate/shared";

import { ApiError, apiClient } from "./api-client.ts";

const RANK = { viewer: 0, qa: 1, admin: 2 } as const satisfies Record<Role, number>;

const [session, setSession] = createSignal<Me | null>(null);
const [sessionReady, setSessionReady] = createSignal(false);

export { session, setSession, sessionReady };

export function actor(): Actor | null {
  return session()?.actor ?? null;
}

/** Cumulative roles: admin includes qa, qa includes viewer. */
export function hasRole(minimum: Role): boolean {
  const current = actor();
  return current !== null && RANK[current.role] >= RANK[minimum];
}

/** Resolves the cookie session once at boot; 401 means signed out, anything else is an error. */
export async function loadSession(): Promise<void> {
  try {
    setSession(await apiClient.get("/auth/me", { schema: meSchema }));
  } catch (cause: unknown) {
    if (!(cause instanceof ApiError) || cause.status !== 401) throw cause;
    setSession(null);
  } finally {
    setSessionReady(true);
  }
}

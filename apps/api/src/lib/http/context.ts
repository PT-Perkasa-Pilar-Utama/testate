import type { Actor } from "@testate/shared";

import type { WideEvent } from "../logger/index.ts";

declare module "hono" {
  // oxlint-disable-next-line typescript/consistent-type-definitions -- Hono merges context variables through interface augmentation
  interface ContextVariableMap {
    event: WideEvent;
    requestId: string;
    actor: Actor | null;
    authKind: "session" | "bearer";
    passwordChangeRequired: boolean;
    projectScope: string[] | null;
  }
}

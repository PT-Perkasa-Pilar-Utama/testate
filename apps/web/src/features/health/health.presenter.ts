import { createMemo, createSignal } from "solid-js";

import { healthModel } from "./health.model.ts";
import type { HealthPublic } from "./health.model.ts";

export type HealthPresenter = {
  health: () => HealthPublic;
  refresh: () => void;
};

export function createHealthPresenter(): HealthPresenter {
  const [version, bump] = createSignal(0);
  const health = createMemo(async (): Promise<HealthPublic> => {
    version();
    return healthModel.get();
  });
  return { health, refresh: () => bump((n) => n + 1) };
}

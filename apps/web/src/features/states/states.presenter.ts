import type { State } from "@testate/shared";

import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { statesModel } from "./states.model.ts";

export type StatesPresenter = Refreshable<State[]>;

export function createStatesPresenter(slug: () => string): StatesPresenter {
  return createRefreshable(() => statesModel.list(slug()));
}

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** 1536 -> "1.5 KB"; integer bytes only, base 1024. */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${UNITS[unit]}`;
}

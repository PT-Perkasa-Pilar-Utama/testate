import type { Settings } from "@testate/shared";

import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { settingsModel } from "./settings.model.ts";

export type SettingRow = { key: string; value: string; locked: boolean };

export type SettingsPresenter = Refreshable<Settings> & {
  rows: (section: "retention" | "limits" | "quota") => SettingRow[];
};

/** Flattens one settings section into rows; a key in `locked_by_env` is read-only in the UI. */
export function createSettingsPresenter(): SettingsPresenter {
  const settings = createRefreshable(() => settingsModel.get());
  return {
    ...settings,
    rows: (section) => {
      const current = settings.value();
      return Object.entries(current[section]).map(([name, value]) => ({
        key: `${section}.${name}`,
        value: value === null ? "unset" : String(value),
        locked: current.locked_by_env.includes(`${section}.${name}`),
      }));
    },
  };
}

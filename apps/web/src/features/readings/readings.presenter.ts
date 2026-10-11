import { createSignal } from "solid-js";
import type { Reading } from "@testate/shared";

import { humanMessage } from "@/lib/api-error.ts";
import { createRefreshable } from "@/lib/async.ts";
import { counted } from "@/lib/format.ts";
import type { Refreshable } from "@/lib/async.ts";
import { showToast } from "@/lib/toast.ts";
import { readingsModel } from "./readings.model.ts";

export type ReadingsPresenter = {
  list: Refreshable<Reading[]>;
  taking: () => boolean;
  error: () => string | null;
  take: () => Promise<void>;
  /** The readings picked to look at: one shows alone, two compare. */
  picked: () => readonly string[];
  toggle: (id: string) => void;
};

/** Picks at most two; a third replaces the older pick, so Compare always holds the last two. */
export function nextPicked(picked: readonly string[], id: string): string[] {
  if (picked.includes(id)) return picked.filter((item) => item !== id);
  return [...picked, id].slice(-2);
}

/** The picked readings, oldest first, from the list the screen holds. */
export function pickedReadings(list: readonly Reading[], picked: readonly string[]): Reading[] {
  return list
    .filter((reading) => picked.includes(reading.id))
    .sort((a, b) => a.taken_at.localeCompare(b.taken_at));
}

export function createReadingsPresenter(slug: () => string): ReadingsPresenter {
  const list = createRefreshable(() => readingsModel.list(slug()));
  const [taking, setTaking] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [picked, setPicked] = createSignal<readonly string[]>([]);
  return {
    list,
    taking,
    error,
    picked,
    toggle: (id) => setPicked(nextPicked(picked(), id)),
    take: async () => {
      const staticSlug = slug();
      setTaking(true);
      setError(null);
      try {
        const reading = await readingsModel.take(staticSlug);
        const missing = reading.adapters.reduce((sum, item) => sum + item.unavailable.length, 0);
        showToast(
          missing === 0
            ? "Reading taken"
            : `Reading taken; ${counted(missing, "values")} could not be read`,
          missing === 0 ? "success" : "info"
        );
        setPicked([reading.id]);
        list.refresh();
      } catch (cause: unknown) {
        setError(humanMessage(cause, "The reading could not be taken."));
      } finally {
        setTaking(false);
      }
    },
  };
}

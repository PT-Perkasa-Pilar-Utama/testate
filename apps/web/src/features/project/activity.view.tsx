import type { JSX } from "@solidjs/web";
import { Show, createSignal } from "solid-js";

import Tabs from "@/components/tabs.tsx";
import { remember, remembered } from "@/lib/remembered.ts";
import CheckoutsView from "../checkouts/checkouts.view.tsx";
import DiffsView from "../diffs/diffs.view.tsx";
import ImportsView from "../imports/imports.view.tsx";

const CHIPS = [
  { id: "checkouts", label: "Checkouts" },
  { id: "diffs", label: "Diffs" },
  { id: "imports", label: "Imports" },
] as const;
type Chip = (typeof CHIPS)[number]["id"];
const CHIP_IDS: readonly Chip[] = CHIPS.map((chip) => chip.id);

/**
 * What happened to this project.
 *
 * A checkout, a diff and an import run are one kind of thing wearing three names: an event with a
 * job, a status, and a link back to the states it touched. The schema says so already, in
 * `states.stash_reason IN ('checkout', 'import', 'write-session')`. They used to be three sibling
 * tabs beside States, which put an event next to the thing it is an event about
 *.
 *
 * The chips pick which list is on screen, one at a time. Each keeps its own cursor and its own
 * endpoint, which is what makes this cost no API work; one interleaved feed would need a union
 * across three tables and was declined, and an "All" view that stacked the three under headings
 * was dropped as confusing. The chip a person left it on is where it reopens.
 */
export default function ActivityView(props: { slug: string; onChanged: () => void }): JSX.Element {
  const [chip, setChipSignal] = createSignal<Chip>(
    remembered("activity-tab", CHIP_IDS, "checkouts")
  );
  const setChip = (next: Chip): void => {
    remember("activity-tab", next);
    setChipSignal(next);
  };
  return (
    <div class="grid gap-4">
      <Tabs
        items={CHIPS}
        value={chip()}
        onChange={(next) => setChip(next)}
        label="What to show"
        variant="segmented"
      />
      <Show when={chip() === "checkouts"}>
        <CheckoutsView slug={props.slug} onChanged={() => props.onChanged()} />
      </Show>
      <Show when={chip() === "diffs"}>
        <DiffsView slug={props.slug} onChanged={() => props.onChanged()} />
      </Show>
      <Show when={chip() === "imports"}>
        <ImportsView slug={props.slug} />
      </Show>
    </div>
  );
}

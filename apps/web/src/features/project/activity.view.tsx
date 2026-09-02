import type { JSX } from "@solidjs/web";
import { Show, createSignal } from "solid-js";

import Tabs from "@/components/tabs.tsx";
import CheckoutsView from "../checkouts/checkouts.view.tsx";
import DiffsView from "../diffs/diffs.view.tsx";
import ImportsView from "../imports/imports.view.tsx";

const CHIPS = [
  { id: "all", label: "All" },
  { id: "checkouts", label: "Checkouts" },
  { id: "diffs", label: "Diffs" },
  { id: "imports", label: "Imports" },
] as const;
type Chip = (typeof CHIPS)[number]["id"];

/** A heading only when more than one list is on screen; alone, a list needs no label. */
function Section(props: {
  title: string;
  hint: string;
  labelled: boolean;
  children: JSX.Element;
}): JSX.Element {
  return (
    <section class="grid gap-3">
      <Show when={props.labelled}>
        <div class="grid gap-1">
          <h3 class="text-lg font-semibold tracking-tight text-heading">{props.title}</h3>
          <p class="text-sm text-muted">{props.hint}</p>
        </div>
      </Show>
      {props.children}
    </section>
  );
}

/**
 * What happened to this project.
 *
 * A checkout, a diff and an import run are one kind of thing wearing three names: an event with a
 * job, a status, and a link back to the states it touched. The schema says so already, in
 * `states.stash_reason IN ('checkout', 'import', 'write-session')`. They used to be three sibling
 * tabs beside States, which put an event next to the thing it is an event about
 * (docs/PROJECT_REWORK.md).
 *
 * The chips filter which list is on screen rather than merging the three. Each keeps its own
 * cursor and its own endpoint, which is what makes this cost no API work; one interleaved feed
 * would need a union across three tables and was declined for that.
 */
export default function ActivityView(props: { slug: string; onChanged: () => void }): JSX.Element {
  const [chip, setChip] = createSignal<Chip>("all");
  const shows = (which: Chip): boolean => chip() === "all" || chip() === which;
  const labelled = (): boolean => chip() === "all";
  return (
    <div class="grid gap-6">
      <Tabs
        items={CHIPS}
        value={chip()}
        onChange={(next) => setChip(next)}
        label="What to show"
        variant="segmented"
      />
      <Show when={shows("checkouts")}>
        <Section
          title="Checkouts"
          hint="A state put back over the live databases."
          labelled={labelled()}
        >
          <CheckoutsView slug={props.slug} onChanged={() => props.onChanged()} />
        </Section>
      </Show>
      <Show when={shows("diffs")}>
        <Section
          title="Diffs"
          hint="Two states compared. A diff is kept for a week, then swept."
          labelled={labelled()}
        >
          <DiffsView slug={props.slug} />
        </Section>
      </Show>
      <Show when={shows("imports")}>
        <Section
          title="Imports"
          hint="A file loaded into one table of one database."
          labelled={labelled()}
        >
          <ImportsView slug={props.slug} />
        </Section>
      </Show>
    </div>
  );
}

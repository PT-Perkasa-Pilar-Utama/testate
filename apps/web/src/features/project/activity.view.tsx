import type { JSX } from "@solidjs/web";

import CheckoutsView from "../checkouts/checkouts.view.tsx";
import DiffsView from "../diffs/diffs.view.tsx";
import ImportsView from "../imports/imports.view.tsx";

function Section(props: { title: string; hint: string; children: JSX.Element }): JSX.Element {
  return (
    <section class="grid gap-3">
      <div class="grid gap-1">
        <h3 class="text-base font-semibold text-heading">{props.title}</h3>
        <p class="text-sm text-muted">{props.hint}</p>
      </div>
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
 */
export default function ActivityView(props: { slug: string; onChanged: () => void }): JSX.Element {
  return (
    <div class="grid gap-8">
      <Section title="Checkouts" hint="A state put back over the live databases.">
        <CheckoutsView slug={props.slug} onChanged={() => props.onChanged()} />
      </Section>
      <Section title="Diffs" hint="Two states compared. A diff is kept for a week, then swept.">
        <DiffsView slug={props.slug} />
      </Section>
      <Section title="Imports" hint="A file loaded into one table of one database.">
        <ImportsView slug={props.slug} />
      </Section>
    </div>
  );
}

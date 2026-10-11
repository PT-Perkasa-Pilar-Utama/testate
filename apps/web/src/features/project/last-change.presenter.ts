import { createEffect, createSignal } from "solid-js";
import type { DataChangeAction, LastChange } from "@testate/shared";

import { formatAgo } from "@/lib/format.ts";
import { projectsModel } from "../projects/projects.model.ts";

export type Change = NonNullable<LastChange["last_change"]>;

const SAID: Record<DataChangeAction, (who: string, target: string, adapter: string) => string> = {
  "checkout.created": (who, target) => `${who} checked out ${target}`,
  "import.run": (who, _target, adapter) => `${who} imported into ${adapter}`,
  "write_session.started": (who, _target, adapter) => `${who} started writing to ${adapter}`,
  "file.uploaded": (who, target, adapter) => `${who} uploaded ${target} to ${adapter}`,
  "file.renamed": (who, target, adapter) => `${who} renamed ${target} on ${adapter}`,
  "file.copied": (who, target, adapter) => `${who} copied ${target} on ${adapter}`,
  "file.deleted": (who, target, adapter) => `${who} deleted ${target} from ${adapter}`,
};

/** "tina.qa checked out before-refund 4 minutes ago." (#60, decision Q2). */
export function lastChangeLine(change: Change, now: Date = new Date()): string {
  const said = SAID[change.action](
    change.actor.label,
    change.target_label ?? "a state",
    change.adapter_name ?? "a database"
  );
  return `${said} ${formatAgo(change.at, now)}.`;
}

export type LastChangePresenter = { line: () => string | null };

/** Reads the project's last change by someone else each time `active` turns on. */
export function createLastChangePresenter(
  slug: () => string,
  active: () => boolean
): LastChangePresenter {
  const [change, setChange] = createSignal<Change | null>(null);
  let request = 0;
  const load = async (staticSlug: string, mine: number): Promise<void> => {
    try {
      const { last_change } = await projectsModel.lastChange(staticSlug);
      if (mine === request) setChange(last_change);
    } catch {
      // A warning, not a gate: when it cannot be read, the action goes ahead without one.
      if (mine === request) setChange(null);
    }
  };
  createEffect(
    () => (active() ? slug() : null),
    (staticSlug) => {
      const mine = ++request;
      if (staticSlug === null) setChange(null);
      else void load(staticSlug, mine);
    }
  );
  return {
    line: () => {
      const current = change();
      return current === null ? null : lastChangeLine(current);
    },
  };
}

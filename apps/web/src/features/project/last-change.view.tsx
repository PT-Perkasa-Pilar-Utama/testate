import { Show } from "solid-js";
import type { JSX } from "@solidjs/web";

import Banner from "@/components/banner.tsx";
import Icon from "@/components/icon.tsx";
import { createLastChangePresenter } from "./last-change.presenter.ts";

type LastChangeProps = { slug: string; active: boolean };

/** Before a checkout or an import: someone else changed this project's data last (#60). */
export function LastChangeBanner(props: LastChangeProps): JSX.Element {
  const presenter = createLastChangePresenter(
    () => props.slug,
    () => props.active
  );
  return (
    <Show when={presenter.line()}>
      {(line) => (
        <Banner variant="alert">{line()} Check with them before you overwrite their data.</Banner>
      )}
    </Show>
  );
}

/** The same warning as one quiet line, beside the write-mode switch. */
export function LastChangeNote(props: LastChangeProps): JSX.Element {
  const presenter = createLastChangePresenter(
    () => props.slug,
    () => props.active
  );
  return (
    <Show when={presenter.line()}>
      {(line) => (
        <p class="flex items-center gap-1.5 text-xs text-warning-fg">
          <Icon name="triangle-alert" class="h-3 w-3" />
          {line()}
        </p>
      )}
    </Show>
  );
}

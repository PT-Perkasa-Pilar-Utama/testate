import type { JSX } from "@solidjs/web";
import { Loading, Show } from "solid-js";
import type { Adapter } from "@testate/shared";

import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import Dialog, { DialogActions } from "@/components/dialog.tsx";
import FieldLabel from "@/components/field-label.tsx";
import Select from "@/components/select.tsx";
import { createMovePresenter } from "./adapter.move.ts";
import { leavesHistory, moveOptions } from "./adapter.move.rules.ts";

/**
 * "Move to project…" on the adapter page (#77, M7). The adapter keeps its id; a database leaves
 * its old project's states, and the dialog says so before the confirm (M2, ADR 0005).
 */
export function MoveControl(props: {
  slug: string;
  adapter: Adapter;
  inspect: boolean;
}): JSX.Element {
  const move = createMovePresenter(
    () => props.slug,
    () => props.adapter
  );
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => move.openMove()}>
        Move to project…
      </Button>
      <Dialog
        open={move.open()}
        onClose={move.close}
        title={`Move ${props.adapter.name}`}
        description="It keeps its id and everything attached to it: policies, saved queries, mappings, host key, pushed logs."
      >
        <div class="grid gap-4">
          <label class="grid content-start gap-1.5 text-base">
            <FieldLabel required={true}>To project</FieldLabel>
            <Loading fallback={<span class="text-sm text-muted">Listing projects...</span>}>
              <Select
                options={[
                  { value: "", label: "Pick a project", disabled: true },
                  ...moveOptions(props.adapter, move.projects.value(), props.slug),
                ]}
                value={move.target()}
                onChange={(slug) => move.setTarget(slug)}
              />
            </Loading>
          </label>
          <Show when={leavesHistory(props.adapter, props.inspect)}>
            <Banner variant="alert">
              This project's states can no longer restore this database. It keeps what it holds now,
              and the new project takes an init snapshot of it.
            </Banner>
          </Show>
          <Show when={move.error()}>
            {(message) => <Banner variant="error">{message()}</Banner>}
          </Show>
          <DialogActions>
            <Button variant="ghost" onClick={() => move.close()}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={move.busy() || move.target() === ""}
              onClick={() => void move.confirm()}
            >
              Move
            </Button>
          </DialogActions>
        </div>
      </Dialog>
    </>
  );
}

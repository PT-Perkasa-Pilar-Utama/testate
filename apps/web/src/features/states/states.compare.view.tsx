import type { JSX } from "@solidjs/web";
import { Loading, createSignal } from "solid-js";

import Button from "@/components/button.tsx";
import Dialog, { DialogActions } from "@/components/dialog.tsx";
import Pending from "@/components/pending.tsx";
import FieldLabel from "@/components/field-label.tsx";
import Select from "@/components/select.tsx";
import type { StatesPresenter } from "./states.presenter.ts";

const LIVE_OPTION = "__live__";

/**
 * Two states, or a state and the live databases, side by side. The ticks on the timeline ask
 * the same question in fewer clicks, but a tick is easy to miss; this is the menu for it.
 */
export default function CompareDialog(props: {
  presenter: StatesPresenter;
  onDone: () => void;
  /** The base a page opens with, before the reader picks one. */
  base?: string;
}): JSX.Element {
  // Plain functions, read inside the dialog's own Loading below: the states list is async, and a
  // memo over it at setup would park the whole route on its fallback until it resolved.
  const states = (): { value: string; label: string }[] =>
    props.presenter.value().map((state) => ({ value: state.id, label: state.name }));
  const [base, setBase] = createSignal("");
  const [target, setTarget] = createSignal(LIVE_OPTION);
  const baseId = (): string => base() || props.base || (states()[0]?.value ?? "");
  const targets = (): { value: string; label: string }[] => [
    { value: LIVE_OPTION, label: "the live databases" },
    ...states().filter((option) => option.value !== baseId()),
  ];
  const submit = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();
    const picked = target() === LIVE_OPTION ? null : target();
    if (await props.presenter.compareWith(baseId(), picked)) props.onDone();
  };
  return (
    <Dialog
      open={props.presenter.comparing()}
      onClose={props.presenter.closeCompare}
      title="Compare"
      size="lg"
      description="What changed between two points. The result lands in Activity, under Diffs."
    >
      <Loading fallback={<Pending>Loading states...</Pending>}>
        <form class="grid gap-4" onSubmit={(event) => void submit(event)}>
          <div class="grid gap-1.5">
            <FieldLabel required={true}>From</FieldLabel>
            <Select options={states()} value={baseId()} onChange={setBase} aria-label="From" />
          </div>
          <div class="grid gap-1.5">
            <FieldLabel required={true}>To</FieldLabel>
            <Select options={targets()} value={target()} onChange={setTarget} aria-label="To" />
          </div>
          <DialogActions>
            <Button type="button" variant="ghost" onClick={props.presenter.closeCompare}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={baseId() === ""}>
              Compare
            </Button>
          </DialogActions>
        </form>
      </Loading>
    </Dialog>
  );
}

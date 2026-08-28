import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import Input from "@/components/input.tsx";
import LayerCard from "@/components/layer-card.tsx";
import { createPasswordPresenter } from "./auth.presenter.ts";

/** Shown instead of the app while `must_change_password` is set (bootstrap admin, admin reset). */
export default function ChangePasswordView(): JSX.Element {
  const presenter = createPasswordPresenter();
  const onSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    void presenter.submit();
  };
  return (
    <section class="mx-auto mt-16 w-full max-w-sm">
      <LayerCard class="grid gap-5 px-6 py-6">
        <div class="grid gap-1">
          <h1 class="text-lg font-semibold">Choose a new password</h1>
          <p class="text-kumo-subtle text-sm">Your password was set by an administrator.</p>
        </div>
        <form class="grid gap-4" onSubmit={onSubmit}>
          <label class="grid gap-1.5 text-sm">
            <span>Current password</span>
            <Input
              type="password"
              autocomplete="current-password"
              required
              value={presenter.current()}
              onInput={(event) => presenter.setCurrent(event.currentTarget.value)}
            />
          </label>
          <label class="grid gap-1.5 text-sm">
            <span>New password</span>
            <Input
              type="password"
              autocomplete="new-password"
              required
              value={presenter.next()}
              onInput={(event) => presenter.setNext(event.currentTarget.value)}
            />
          </label>
          <Show when={presenter.error()}>
            {(message) => <Banner variant="error">{message()}</Banner>}
          </Show>
          <Button type="submit" variant="primary" disabled={presenter.busy()}>
            Save password
          </Button>
        </form>
      </LayerCard>
    </section>
  );
}

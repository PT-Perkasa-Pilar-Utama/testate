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
    // The same shape as the sign-in screen it follows.
    <section class="mx-auto grid w-full max-w-[340px] gap-6 pt-16">
      <div class="grid justify-items-center gap-2 text-center">
        <span class="text-2xl font-semibold text-kumo-strong">Testate</span>
        <p class="text-kumo-subtle">Your password was set by an administrator</p>
      </div>
      <LayerCard class="grid gap-4 px-6 py-5">
        <h1 class="text-base font-semibold text-kumo-strong">Choose a new password</h1>
        <form class="grid gap-4" onSubmit={onSubmit}>
          <label class="grid gap-1.5 text-base">
            <span>Current password</span>
            <Input
              type="password"
              autocomplete="current-password"
              required
              value={presenter.current()}
              onInput={(event) => presenter.setCurrent(event.currentTarget.value)}
            />
          </label>
          <label class="grid gap-1.5 text-base">
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

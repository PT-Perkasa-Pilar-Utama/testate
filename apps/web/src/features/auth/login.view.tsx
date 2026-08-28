import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import Input from "@/components/input.tsx";
import LayerCard from "@/components/layer-card.tsx";
import { createLoginPresenter } from "./auth.presenter.ts";

export default function LoginView(props: { next: string }): JSX.Element {
  const presenter = createLoginPresenter(() => props.next);
  const onSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    void presenter.submit();
  };
  return (
    <section class="mx-auto mt-16 w-full max-w-sm">
      <LayerCard class="grid gap-5 px-6 py-6">
        <div class="grid gap-1">
          <h1 class="text-lg font-semibold">Sign in to Testate</h1>
          <p class="text-kumo-subtle text-sm">Git for your test database.</p>
        </div>
        <form class="grid gap-4" onSubmit={onSubmit}>
          <label class="grid gap-1.5 text-sm">
            <span>Username</span>
            <Input
              name="username"
              autocomplete="username"
              required
              value={presenter.username()}
              onInput={(event) => presenter.setUsername(event.currentTarget.value)}
            />
          </label>
          <label class="grid gap-1.5 text-sm">
            <span>Password</span>
            <Input
              name="password"
              type="password"
              autocomplete="current-password"
              required
              value={presenter.password()}
              onInput={(event) => presenter.setPassword(event.currentTarget.value)}
            />
          </label>
          <Show when={presenter.error()}>
            {(message) => <Banner variant="error">{message()}</Banner>}
          </Show>
          <Button type="submit" variant="primary" disabled={presenter.busy()}>
            {presenter.busy() ? "Signing in..." : "Sign in"}
          </Button>
        </form>
      </LayerCard>
    </section>
  );
}

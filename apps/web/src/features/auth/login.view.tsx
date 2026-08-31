import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import FormErrors from "@/components/form-errors.tsx";
import Icon from "@/components/icon.tsx";
import Input from "@/components/input.tsx";
import LayerCard from "@/components/layer-card.tsx";
import { createFormGuard } from "@/lib/form.ts";
import { createLoginPresenter } from "./auth.presenter.ts";

export default function LoginView(props: { next: string }): JSX.Element {
  const presenter = createLoginPresenter(() => props.next);
  const guard = createFormGuard();
  return (
    // GitHub's sign-in: the mark above a narrow card, nothing else on the page.
    <section class="mx-auto grid w-full max-w-[340px] gap-6 pt-16">
      <div class="grid justify-items-center gap-2 text-center">
        <span class="text-2xl font-semibold text-heading">Testate</span>
        <p class="text-muted">Git for your test database</p>
      </div>
      <LayerCard class="grid gap-4 px-6 py-5">
        <h1 class="text-base font-semibold text-heading">Sign in</h1>
        <form
          class="grid gap-4"
          ref={guard.ref}
          novalidate
          onSubmit={(event) => {
            if (!guard.accepts(event)) return;
            void presenter.submit();
          }}
        >
          <FormErrors errors={guard.errors()} />
          <label class="grid gap-1.5 text-base">
            <span>Username</span>
            <Input
              name="username"
              autocomplete="username"
              autofocus
              required
              value={presenter.username()}
              onInput={(event) => presenter.setUsername(event.currentTarget.value)}
            />
          </label>
          <label class="grid gap-1.5 text-base">
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
            <Show when={presenter.busy()}>
              <Icon name="loader-circle" class="h-3.5 w-3.5 animate-spin" />
            </Show>
            {presenter.busy() ? "Signing in..." : "Sign in"}
          </Button>
        </form>
      </LayerCard>
      <p class="text-center text-xs text-muted">Your databases, your network. Nothing leaves it.</p>
    </section>
  );
}

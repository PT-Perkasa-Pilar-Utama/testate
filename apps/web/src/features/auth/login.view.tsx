import { Field, Form, createForm } from "@formisch/solid";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import { loginSchema } from "@testate/shared";

import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import FieldError from "@/components/field-error.tsx";
import Icon from "@/components/icon.tsx";
import Input from "@/components/input.tsx";
import LayerCard from "@/components/layer-card.tsx";
import Logo from "@/components/logo.tsx";
import { createLoginPresenter } from "./auth.presenter.ts";

/**
 * The sign-in form, and the reference for every other form in the app: one valibot schema from
 * `@testate/shared` drives the fields, their messages and the submitted values, so nothing about
 * the shape is written twice. See the `formisch-forms` skill.
 */
export default function LoginView(props: { next: string }): JSX.Element {
  const presenter = createLoginPresenter(() => props.next);
  const form = createForm({ schema: loginSchema });
  return (
    // GitHub's sign-in: the mark above a narrow card, nothing else on the page. The page centres
    // this, so there is no padding here pushing it off the middle.
    <section class="grid w-full max-w-[340px] gap-6">
      <div class="grid justify-items-center gap-2 text-center">
        <Logo class="h-12 w-12 text-accent" label="Testate" />
        <span class="text-2xl font-semibold text-heading">Testate</span>
        <p class="text-muted">Git for your test database</p>
      </div>
      <LayerCard class="grid gap-4 px-6 py-5">
        <h1 class="text-base font-semibold text-heading">Sign in</h1>
        <Form of={form} class="grid gap-4" onSubmit={(input) => presenter.submit(input)}>
          <Field of={form} path={["username"]}>
            {(field) => (
              <label class="grid gap-1.5 text-base">
                <span>Username</span>
                <Input
                  {...field.props}
                  type="text"
                  autocomplete="username"
                  autofocus
                  value={field.input}
                  variant={field.errors ? "error" : "default"}
                  aria-invalid={field.errors ? "true" : undefined}
                />
                <FieldError message={field.errors?.[0]} />
              </label>
            )}
          </Field>
          <Field of={form} path={["password"]}>
            {(field) => (
              <label class="grid gap-1.5 text-base">
                <span>Password</span>
                <Input
                  {...field.props}
                  type="password"
                  autocomplete="current-password"
                  value={field.input}
                  variant={field.errors ? "error" : "default"}
                  aria-invalid={field.errors ? "true" : undefined}
                />
                <FieldError message={field.errors?.[0]} />
              </label>
            )}
          </Field>
          {/* What the server said, which is never a field's fault: a wrong password, a locked
              account, an address over its guess budget. */}
          <Show when={presenter.error()}>
            {(message) => <Banner variant="error">{message()}</Banner>}
          </Show>
          <Button type="submit" variant="primary" disabled={presenter.busy()}>
            <Show when={presenter.busy()}>
              <Icon name="loader-circle" class="h-3.5 w-3.5 animate-spin" />
            </Show>
            {presenter.busy() ? "Signing in..." : "Sign in"}
          </Button>
        </Form>
      </LayerCard>
      <p class="text-center text-xs text-muted">Your databases, your network. Nothing leaves it.</p>
    </section>
  );
}

import { Field, Form, createForm } from "@formisch/solid";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import { changePasswordSchema } from "@testate/shared";

import Banner from "@/components/banner.tsx";
import Button from "@/components/button.tsx";
import FieldError from "@/components/field-error.tsx";
import Icon from "@/components/icon.tsx";
import Input from "@/components/input.tsx";
import LayerCard from "@/components/layer-card.tsx";
import { createPasswordPresenter } from "./auth.presenter.ts";

/** Shown instead of the app while `must_change_password` is set (bootstrap admin, admin reset). */
export default function ChangePasswordView(): JSX.Element {
  const presenter = createPasswordPresenter();
  const form = createForm({ schema: changePasswordSchema });
  return (
    // The same shape as the sign-in screen it follows.
    <section class="mx-auto grid w-full max-w-[340px] gap-6 pt-16">
      <div class="grid justify-items-center gap-2 text-center">
        <span class="text-2xl font-semibold text-heading">Testate</span>
        <p class="text-muted">Your password was set by an administrator</p>
      </div>
      <LayerCard class="grid gap-4 px-6 py-5">
        <h1 class="text-base font-semibold text-heading">Choose a new password</h1>
        <Form of={form} class="grid gap-4" onSubmit={(input) => presenter.submit(input)}>
          <Field of={form} path={["current"]}>
            {(field) => (
              <label class="grid content-start gap-1.5 text-base">
                <span>Current password</span>
                <Input
                  {...field.props}
                  type="password"
                  autocomplete="current-password"
                  autofocus
                  required
                  value={field.input}
                  variant={field.errors ? "error" : "default"}
                  aria-invalid={field.errors ? "true" : undefined}
                />
                <FieldError message={field.errors?.[0]} />
              </label>
            )}
          </Field>
          <Field of={form} path={["next"]}>
            {(field) => (
              <label class="grid content-start gap-1.5 text-base">
                <span>New password</span>
                <Input
                  {...field.props}
                  type="password"
                  autocomplete="new-password"
                  required
                  value={field.input}
                  variant={field.errors ? "error" : "default"}
                  aria-invalid={field.errors ? "true" : undefined}
                />
                <FieldError message={field.errors?.[0]} />
              </label>
            )}
          </Field>
          {/* A refused current password is the server's answer, not a schema failure - it stays a
              banner rather than a field message. */}
          <Show when={presenter.error()}>
            {(message) => <Banner variant="error">{message()}</Banner>}
          </Show>
          <Button type="submit" variant="primary" disabled={presenter.busy()}>
            <Show when={presenter.busy()}>
              <Icon name="loader-circle" class="h-3.5 w-3.5 animate-spin" />
            </Show>
            {presenter.busy() ? "Saving..." : "Save password"}
          </Button>
        </Form>
      </LayerCard>
    </section>
  );
}

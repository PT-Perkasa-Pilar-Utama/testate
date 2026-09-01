import { createSignal } from "solid-js";
import type { ChangePasswordInput, LoginInput } from "@testate/shared";

import { navigate } from "@/lib/router.ts";
import { loadSession, setSession } from "@/lib/session.ts";
import { authModel } from "./auth.model.ts";

/**
 * The form holds the two fields and validates them; this holds what only the server can answer.
 * A wrong password is not a validation error, so it stays a banner rather than a field message.
 */
export type LoginPresenter = {
  error: () => string | null;
  busy: () => boolean;
  submit: (input: LoginInput) => Promise<void>;
};

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : "login failed";
}

export function createLoginPresenter(next: () => string): LoginPresenter {
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  return {
    error,
    busy,
    submit: async (input) => {
      setBusy(true);
      setError(null);
      try {
        await authModel.login({ username: input.username.trim(), password: input.password });
        await loadSession();
        navigate(next(), true);
      } catch (cause: unknown) {
        setError(messageOf(cause));
      } finally {
        setBusy(false);
      }
    },
  };
}

/**
 * The form validates current/next against `changePasswordSchema` (length, and "next differs from
 * current"); this holds only what the server can answer - a current password the API refuses.
 */
export type PasswordPresenter = {
  error: () => string | null;
  busy: () => boolean;
  submit: (input: ChangePasswordInput) => Promise<void>;
};

export function createPasswordPresenter(): PasswordPresenter {
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  return {
    error,
    busy,
    submit: async (input) => {
      setBusy(true);
      setError(null);
      try {
        await authModel.changePassword(input);
        await loadSession();
      } catch (cause: unknown) {
        setError(messageOf(cause));
      } finally {
        setBusy(false);
      }
    },
  };
}

export async function signOut(): Promise<void> {
  await authModel.logout();
  setSession(null);
  navigate("/login", true);
}

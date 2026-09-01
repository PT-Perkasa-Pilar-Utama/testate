import { createSignal } from "solid-js";
import { PASSWORD_MIN_LENGTH } from "@testate/shared";
import type { LoginInput } from "@testate/shared";

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

export type PasswordPresenter = {
  current: () => string;
  next: () => string;
  error: () => string | null;
  busy: () => boolean;
  setCurrent: (value: string) => void;
  setNext: (value: string) => void;
  submit: () => Promise<void>;
};

export function createPasswordPresenter(): PasswordPresenter {
  const [current, setCurrent] = createSignal("");
  const [next, setNext] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  return {
    current,
    next,
    error,
    busy,
    setCurrent,
    setNext,
    submit: async () => {
      if (next().length < PASSWORD_MIN_LENGTH) {
        setError(`new password needs at least ${PASSWORD_MIN_LENGTH} characters`);
        return;
      }
      setBusy(true);
      setError(null);
      try {
        await authModel.changePassword({ current: current(), next: next() });
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

import { createSignal } from "solid-js";
import { PASSWORD_MIN_LENGTH } from "@testate/shared";

import { navigate } from "@/lib/router.ts";
import { loadSession, setSession } from "@/lib/session.ts";
import { authModel } from "./auth.model.ts";

export type LoginPresenter = {
  username: () => string;
  password: () => string;
  error: () => string | null;
  busy: () => boolean;
  setUsername: (value: string) => void;
  setPassword: (value: string) => void;
  submit: () => Promise<void>;
};

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : "login failed";
}

export function createLoginPresenter(next: () => string): LoginPresenter {
  const [username, setUsername] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  return {
    username,
    password,
    error,
    busy,
    setUsername,
    setPassword,
    submit: async () => {
      setBusy(true);
      setError(null);
      try {
        await authModel.login({ username: username().trim(), password: password() });
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

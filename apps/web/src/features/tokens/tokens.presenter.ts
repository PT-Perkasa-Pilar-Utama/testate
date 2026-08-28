import { createSignal } from "solid-js";
import type { ApiToken, JsonObject, Role, TokenKind } from "@testate/shared";
import { ROLES, TOKEN_KINDS } from "@testate/shared";

import { attempt, showToast } from "@/components/toast.tsx";
import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { tokensModel } from "./tokens.model.ts";

export const KIND_OPTIONS = TOKEN_KINDS.map((kind) => ({ value: kind, label: kind }));
export const ROLE_OPTIONS = ROLES.map((role) => ({ value: role, label: role }));

export type TokenDraft = { name: string; kind: TokenKind; role: Role; expires_on: string };

const EMPTY_DRAFT: TokenDraft = { name: "", kind: "standard", role: "qa", expires_on: "" };

export type TokensPresenter = Refreshable<ApiToken[]> & {
  creating: () => boolean;
  draft: () => TokenDraft;
  error: () => string | null;
  created: () => string | null;
  openCreate: () => void;
  closeCreate: () => void;
  setDraft: (patch: Partial<TokenDraft>) => void;
  create: () => Promise<void>;
  copyCreated: () => Promise<void>;
  dismissCreated: () => void;
  revoke: (token: ApiToken) => Promise<void>;
};

/** Agent tokens are always viewer, so the role is sent for standard tokens only (02 §2.7). */
export function toCreateBody(draft: TokenDraft): JsonObject {
  const body: JsonObject = { name: draft.name.trim(), kind: draft.kind };
  if (draft.kind === "standard") body["role"] = draft.role;
  if (draft.expires_on !== "")
    body["expires_at"] = new Date(`${draft.expires_on}T23:59:59Z`).toISOString();
  return body;
}

export function createTokensPresenter(): TokensPresenter {
  const tokens = createRefreshable(() => tokensModel.list());
  const [creating, setCreating] = createSignal(false);
  const [draft, setDraftSignal] = createSignal<TokenDraft>(EMPTY_DRAFT);
  const [error, setError] = createSignal<string | null>(null);
  const [created, setCreated] = createSignal<string | null>(null);
  return {
    ...tokens,
    creating,
    draft,
    error,
    created,
    openCreate: () => setCreating(true),
    closeCreate: () => {
      setCreating(false);
      setError(null);
    },
    setDraft: (patch) => setDraftSignal((current) => ({ ...current, ...patch })),
    create: async () => {
      setError(null);
      try {
        const result = await tokensModel.create(toCreateBody(draft()));
        setCreated(result.token);
        setCreating(false);
        setDraftSignal(EMPTY_DRAFT);
        tokens.refresh();
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : "could not create the token");
      }
    },
    copyCreated: () => {
      const staticToken = created();
      if (staticToken === null) return Promise.resolve();
      return attempt(async () => {
        await navigator.clipboard.writeText(staticToken);
        showToast("Token copied", "success");
      });
    },
    dismissCreated: () => setCreated(null),
    revoke: (token) =>
      attempt(async () => {
        if (!window.confirm(`Revoke ${token.name}? Requests with it fail from now on.`)) return;
        await tokensModel.revoke(token.id);
        tokens.refresh();
      }),
  };
}

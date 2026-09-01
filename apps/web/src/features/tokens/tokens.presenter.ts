import { createSignal } from "solid-js";
import type { ApiToken, JsonObject, TokenDraft } from "@testate/shared";
import { ROLES, TOKEN_KINDS } from "@testate/shared";

import { humanMessage } from "@/lib/api-error.ts";
import { attempt, showToast } from "@/lib/toast.ts";
import { createPaged } from "@/lib/async.ts";
import { createTableView } from "@/lib/table.ts";
import type { TableView } from "@/lib/table.ts";
import type { Paged } from "@/lib/async.ts";
import type { CreatedToken } from "./tokens.model.ts";
import { tokensModel } from "./tokens.model.ts";

export const KIND_OPTIONS = TOKEN_KINDS.map((kind) => ({ value: kind, label: kind }));
export const ROLE_OPTIONS = ROLES.map((role) => ({ value: role, label: role }));

/** The dialog's own starting point; also what it resets to on close (`tokenDraftSchema`). */
export const EMPTY_DRAFT: TokenDraft = { name: "", kind: "standard", role: "qa", expires_on: "" };

export type TokenSort = "name" | "kind" | "role" | "last_used_at" | "expires_at";

export type TokensPresenter = Paged<ApiToken> & {
  table: TableView<ApiToken, TokenSort>;
  creating: () => boolean;
  error: () => string | null;
  /** The freshly minted token plus the record it belongs to; null once dismissed. Testate never
   *  shows the secret again after this, so the reveal reads from this signal and nowhere else. */
  created: () => CreatedToken | null;
  openCreate: () => void;
  closeCreate: () => void;
  create: (input: TokenDraft) => Promise<void>;
  copyCreated: () => Promise<void>;
  dismissCreated: () => void;
  /** The token the revoke dialog is asking about, null when it is closed. */
  revoking: () => ApiToken | null;
  askRevoke: (token: ApiToken) => void;
  cancelRevoke: () => void;
  revoke: () => Promise<void>;
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
  const tokens = createPaged((cursor) => tokensModel.page(cursor));
  const table = createTableView<ApiToken, TokenSort>({
    rows: () => tokens.value(),
    sorters: {
      name: { text: (token) => token.name },
      kind: { text: (token) => token.kind },
      role: { text: (token) => token.role },
      last_used_at: { text: (token) => token.last_used_at },
      expires_at: { text: (token) => token.expires_at },
    },
    fields: (token) => [token.name, token.kind, token.role, token.prefix],
    pager: { hasMore: tokens.hasMore, loadMore: tokens.loadMore },
  });
  const [creating, setCreating] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [created, setCreated] = createSignal<CreatedToken | null>(null);
  const [revoking, setRevoking] = createSignal<ApiToken | null>(null);
  return {
    ...tokens,
    table,
    creating,
    error,
    created,
    openCreate: () => setCreating(true),
    closeCreate: () => {
      setCreating(false);
      setError(null);
    },
    create: async (input) => {
      setError(null);
      try {
        const result = await tokensModel.create(toCreateBody(input));
        setCreated(result);
        setCreating(false);
        tokens.refresh();
      } catch (cause: unknown) {
        setError(humanMessage(cause, "Could not create the token."));
      }
    },
    copyCreated: () => {
      const staticToken = created();
      if (staticToken === null) return Promise.resolve();
      return attempt(async () => {
        await navigator.clipboard.writeText(staticToken.token);
        showToast("Token copied", "success");
      });
    },
    dismissCreated: () => setCreated(null),
    revoking,
    askRevoke: (token) => setRevoking(token),
    cancelRevoke: () => setRevoking(null),
    revoke: () => {
      const staticToken = revoking();
      setRevoking(null);
      return attempt(async () => {
        if (staticToken === null) return;
        await tokensModel.revoke(staticToken.id);
        tokens.refresh();
      });
    },
  };
}

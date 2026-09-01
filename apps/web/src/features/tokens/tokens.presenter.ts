import { createSignal } from "solid-js";
import type { ApiToken, JsonObject, TokenDraft, TokenKind } from "@testate/shared";

import { humanMessage } from "@/lib/api-error.ts";
import { attempt, showToast } from "@/lib/toast.ts";
import { createPaged } from "@/lib/async.ts";
import { createTableControls } from "@/lib/table.ts";
import type { TableView } from "@/lib/table.ts";
import type { Paged } from "@/lib/async.ts";
import type { CreatedToken } from "./tokens.model.ts";
import { tokensModel } from "./tokens.model.ts";

/** The dialog's own starting point; also what it resets to on close (`tokenDraftSchema`). */
export const EMPTY_DRAFT: TokenDraft = {
  name: "",
  kind: "standard",
  role: "qa",
  expiry: "default",
  expires_on: "",
};

export type TokenSort = "name" | "kind" | "role" | "last_used_at" | "expires_at";

/** "" is unfiltered; otherwise the exact string the API's `revoked` query param takes. */
export type RevokedFilter = "" | "true" | "false";

export type TokensPresenter = Paged<ApiToken> & {
  table: TableView<ApiToken, TokenSort>;
  kind: () => TokenKind | "";
  setKind: (kind: TokenKind | "") => void;
  revoked: () => RevokedFilter;
  setRevoked: (revoked: RevokedFilter) => void;
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

/**
 * The dialog's draft as the API's create body (02 §2.7).
 *
 * Three answers, three bodies. `null` asks for a token that never expires, which is not the same
 * message as leaving the field out: an agent token with no expiry named takes the ninety-day
 * default, and a standard one never expires anyway. "default" is the field left out.
 */
export function toCreateBody(draft: TokenDraft): JsonObject {
  const body: JsonObject = { name: draft.name.trim(), kind: draft.kind, role: draft.role };
  if (draft.expiry === "none") body["expires_at"] = null;
  if (draft.expiry === "date" && draft.expires_on !== "")
    body["expires_at"] = new Date(`${draft.expires_on}T23:59:59Z`).toISOString();
  return body;
}

export function createTokensPresenter(): TokensPresenter {
  const controls = createTableControls<TokenSort>();
  const [kind, setKind] = createSignal<TokenKind | "">("");
  const [revoked, setRevoked] = createSignal<RevokedFilter>("");
  const tokens = createPaged(
    (cursor) => tokensModel.page(cursor, controls.params(), kind(), revoked()),
    // Kind and revoked narrow the same list the sort and search do, so either changing has to
    // drop the pages already appended the way a new sort or search does (see `createPaged`).
    () => `${controls.key()}|${kind()}|${revoked()}`
  );
  const table: TableView<ApiToken, TokenSort> = { ...controls, rows: tokens.value };
  const [creating, setCreating] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [created, setCreated] = createSignal<CreatedToken | null>(null);
  const [revoking, setRevoking] = createSignal<ApiToken | null>(null);
  return {
    ...tokens,
    table,
    kind,
    setKind,
    revoked,
    setRevoked,
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

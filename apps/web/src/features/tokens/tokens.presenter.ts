import { createSignal } from "solid-js";
import type {
  ApiToken,
  JsonObject,
  Project,
  ScopeChoice,
  TokenDraft,
  TokenKind,
} from "@testate/shared";
import { projectIdsOf } from "@testate/shared";

import { humanMessage } from "@/lib/api-error.ts";
import { attempt, showToast } from "@/lib/toast.ts";
import { createPaged, createRefreshable } from "@/lib/async.ts";
import { createTableControls } from "@/lib/table.ts";
import type { TableView } from "@/lib/table.ts";
import type { Paged, Refreshable } from "@/lib/async.ts";
import { projectsModel } from "../projects/projects.model.ts";
import type { CreatedToken } from "./tokens.model.ts";
import { tokensModel } from "./tokens.model.ts";

/**
 * The dialog's own starting point; also what it resets to on close (`tokenDraftSchema`).
 *
 * No scope: which projects a token reaches is a choice someone makes (#55), so the form refuses
 * until it is made. The key is present and undefined on purpose; an absent key gets valibot's
 * "Invalid key" message instead of the one the schema writes.
 */
export const EMPTY_DRAFT: Omit<TokenDraft, "scope"> & { scope: undefined } = {
  name: "",
  kind: "standard",
  role: "qa",
  expiry: "default",
  expires_on: "",
  scope: undefined,
  project_ids: [],
};

/**
 * Whether the dialog's scope reaches the built-in Inspect project, which locks the role to Guest:
 * the API refuses any other role there (#56, Q6). "All projects" locks nothing.
 */
export function reachesInspect(
  scope: ScopeChoice | undefined,
  picked: readonly string[],
  projects: readonly Pick<Project, "id" | "kind">[]
): boolean {
  if (scope !== "chosen") return false;
  return projects.some((project) => project.kind === "inspect" && picked.includes(project.id));
}

export type TokenSort = "name" | "kind" | "role" | "last_used_at" | "expires_at";

/** "" is unfiltered; otherwise the exact string the API's `revoked` query param takes. */
export type RevokedFilter = "" | "true" | "false";

export type TokensPresenter = Paged<ApiToken> & {
  table: TableView<ApiToken, TokenSort>;
  /** Every project, for the dialog's picker and the list's scope column. */
  projects: Refreshable<Project[]>;
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
  /** True once when the page was opened as `/tokens?new=inspect`: fill the dialog for Inspect. */
  takeInspectPreset: () => boolean;
  /** The built-in Inspect project's id, for the dialog's "Inspect only" shortcut. */
  inspectProjectId: () => Promise<string | null>;
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
  const body: JsonObject = {
    name: draft.name.trim(),
    kind: draft.kind,
    role: draft.role,
    project_ids: projectIdsOf(draft.scope, draft.project_ids),
  };
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
  // The Inspect page links here to make an agent token for it (#56, Q9): the dialog opens filled.
  let inspectPreset = new URLSearchParams(window.location.search).get("new") === "inspect";
  const [creating, setCreating] = createSignal(inspectPreset);
  const [error, setError] = createSignal<string | null>(null);
  const [created, setCreated] = createSignal<CreatedToken | null>(null);
  const [revoking, setRevoking] = createSignal<ApiToken | null>(null);
  return {
    ...tokens,
    table,
    projects: createRefreshable(() => projectsModel.choices()),
    kind,
    setKind,
    revoked,
    setRevoked,
    creating,
    error,
    created,
    openCreate: () => setCreating(true),
    inspectProjectId: async () => (await projectsModel.inspect())?.id ?? null,
    takeInspectPreset: () => {
      const preset = inspectPreset;
      inspectPreset = false;
      return preset;
    },
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

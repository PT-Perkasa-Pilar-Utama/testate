import { createSignal } from "solid-js";
import type { HttpMethod, JsonObject, RestRequest, RestRun } from "@testate/shared";
import { httpMethodSchema } from "@testate/shared";

import { attempt, showToast } from "@/components/toast.tsx";
import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { restModel } from "./rest.model.ts";

export const METHOD_OPTIONS = httpMethodSchema.options.map((method) => ({
  value: method,
  label: method,
}));

export type RequestDraft = {
  name: string;
  method: HttpMethod;
  path: string;
  /** `key=value` per line; secrets become sealed headers the API never echoes. */
  query: string;
  headers: string;
  secrets: string;
  body: string;
  expected_status: string;
};

export const EMPTY_DRAFT: RequestDraft = {
  name: "",
  method: "GET",
  path: "/",
  query: "",
  headers: "",
  secrets: "",
  body: "",
  expected_status: "",
};

export type RestPresenter = {
  requests: Refreshable<RestRequest[]>;
  draft: () => RequestDraft | null;
  openCreate: () => void;
  closeCreate: () => void;
  setDraft: (patch: Partial<RequestDraft>) => void;
  error: () => string | null;
  create: () => Promise<void>;
  remove: (request: RestRequest) => Promise<void>;
  selected: () => RestRequest | null;
  select: (request: RestRequest | null) => void;
  runs: Refreshable<RestRun[]>;
  lastRun: () => RestRun | null;
  run: (request: RestRequest) => Promise<void>;
};

/** `key=value` lines into a map; blank lines are skipped, a line without `=` is an error. */
export function parseLines(label: string, text: string): JsonObject {
  const map: JsonObject = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    const at = line.indexOf("=");
    if (at <= 0) throw new Error(`${label}: "${line}" is not key=value`);
    map[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return map;
}

/** The POST body (12 §12.1); an empty expected status means any status passes. */
export function requestBody(draft: RequestDraft): JsonObject {
  const expected = Number.parseInt(draft.expected_status, 10);
  return {
    name: draft.name,
    method: draft.method,
    path: draft.path,
    query: parseLines("query", draft.query),
    headers: parseLines("headers", draft.headers),
    secrets: parseLines("secrets", draft.secrets),
    body: draft.body === "" ? null : draft.body,
    expected_status: Number.isInteger(expected) ? expected : null,
  };
}

export function createRestPresenter(slug: () => string, id: () => string): RestPresenter {
  const requests = createRefreshable(() => restModel.list(slug(), id()));
  const [draft, setDraftSignal] = createSignal<RequestDraft | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [selected, setSelected] = createSignal<RestRequest | null>(null);
  const [lastRun, setLastRun] = createSignal<RestRun | null>(null);
  const runs = createRefreshable(async () => {
    const current = selected();
    return current === null ? [] : restModel.runs(slug(), id(), current.id);
  });
  return {
    requests,
    draft,
    openCreate: () => {
      setError(null);
      setDraftSignal(EMPTY_DRAFT);
    },
    closeCreate: () => setDraftSignal(null),
    setDraft: (patch) =>
      setDraftSignal((current) => (current === null ? null : { ...current, ...patch })),
    error,
    create: () => {
      const staticSlug = slug();
      const staticId = id();
      const staticDraft = draft();
      if (staticDraft === null) return Promise.resolve();
      let body: JsonObject;
      try {
        body = requestBody(staticDraft);
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : String(cause));
        return Promise.resolve();
      }
      return attempt(async () => {
        await restModel.create(staticSlug, staticId, body);
        setDraftSignal(null);
        requests.refresh();
        showToast("Request saved", "success");
      });
    },
    remove: (request) => {
      const staticSlug = slug();
      const staticId = id();
      const staticSelectedId = selected()?.id ?? null;
      return attempt(async () => {
        await restModel.remove(staticSlug, staticId, request.id);
        if (staticSelectedId === request.id) setSelected(null);
        requests.refresh();
      });
    },
    selected,
    select: (request) => {
      setSelected(request);
      setLastRun(null);
    },
    runs,
    lastRun,
    run: (request) => {
      const staticSlug = slug();
      const staticId = id();
      return attempt(async () => {
        setSelected(request);
        setLastRun(await restModel.run(staticSlug, staticId, request.id));
        runs.refresh();
      });
    },
  };
}

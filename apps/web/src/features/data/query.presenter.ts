import { createSignal } from "solid-js";
import type { Adapter, JsonObject, JsonValue, QueryRequest, QueryResult } from "@testate/shared";
import { jsonObjectSchema, mongoOperationSchema } from "@testate/shared";
import * as v from "valibot";

import { attempt, showToast } from "@/lib/toast.ts";
import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { adaptersModel } from "../adapters/adapters.model.ts";
import { dataModel } from "./data.model.ts";
import type { HistoryRow, RunningQuery, SavedQuery } from "./data.model.ts";

export const MONGO_OPS = [
  { value: "find", label: "find" },
  { value: "aggregate", label: "aggregate" },
] as const;

export type MongoDraft = {
  op: "find" | "aggregate";
  collection: string;
  filter: string;
  projection: string;
  sort: string;
  pipeline: string;
};

export type QueryPresenter = {
  adapter: Refreshable<Adapter>;
  isMongo: () => boolean;
  sql: () => string;
  setSql: (text: string) => void;
  mongo: () => MongoDraft;
  setMongo: (patch: Partial<MongoDraft>) => void;
  rowCap: () => string;
  setRowCap: (text: string) => void;
  result: () => QueryResult | null;
  error: () => string | null;
  busy: () => boolean;
  run: () => Promise<void>;
  exportAs: (format: "csv" | "json") => Promise<void>;
  saved: Refreshable<SavedQuery[]>;
  saveName: () => string;
  setSaveName: (name: string) => void;
  save: () => Promise<void>;
  load: (query: SavedQuery) => void;
  removeSaved: (id: string) => Promise<void>;
  history: Refreshable<HistoryRow[]>;
  running: Refreshable<RunningQuery[]>;
  cancel: (queryId: string) => Promise<void>;
};

const EMPTY_MONGO: MongoDraft = {
  op: "find",
  collection: "",
  filter: "{}",
  projection: "",
  sort: "",
  pipeline: "[]",
};

function parseJson(label: string, text: string): JsonObject | JsonObject[] | undefined {
  if (text.trim() === "") return undefined;
  try {
    const raw: unknown = JSON.parse(text);
    return Array.isArray(raw)
      ? v.parse(v.array(jsonObjectSchema), raw)
      : v.parse(jsonObjectSchema, raw);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

/** The request body for the console: SQL text, or the Mongo form parsed into an operation. */
export function buildRequest(
  isMongo: boolean,
  sql: string,
  mongo: MongoDraft,
  rowCap: string
): QueryRequest {
  const cap = Number.parseInt(rowCap, 10);
  const base: QueryRequest = { dialect: isMongo ? "mongo" : "sql", mode: "read" };
  if (Number.isInteger(cap) && cap > 0) base.row_cap = cap;
  if (!isMongo) return { ...base, text: sql };
  const operation: JsonObject = { op: mongo.op, collection: mongo.collection };
  const fields: [string, string][] =
    mongo.op === "find"
      ? [
          ["filter", mongo.filter],
          ["projection", mongo.projection],
          ["sort", mongo.sort],
        ]
      : [["pipeline", mongo.pipeline]];
  for (const [key, text] of fields) {
    const parsed = parseJson(key, text);
    if (parsed !== undefined) operation[key] = parsed;
  }
  const parsed = v.safeParse(mongoOperationSchema, operation);
  if (!parsed.success) throw new Error(parsed.issues.map((issue) => issue.message).join("; "));
  return { ...base, mongo: parsed.output };
}

type Draft = { sql: string; mongo: MongoDraft };

function draftOf(body: JsonObject): Draft {
  const text = v.safeParse(v.string(), body["text"]);
  const mongo = v.safeParse(mongoOperationSchema, body["mongo"]);
  if (!mongo.success) return { sql: text.success ? text.output : "", mongo: EMPTY_MONGO };
  const json = (value: JsonValue | undefined): string =>
    value === undefined ? "" : JSON.stringify(value);
  return {
    sql: "",
    mongo: {
      op: mongo.output.op,
      collection: mongo.output.collection,
      filter: json(mongo.output.filter) || "{}",
      projection: json(mongo.output.projection),
      sort: json(mongo.output.sort),
      pipeline: json(mongo.output.pipeline) || "[]",
    },
  };
}

function saveBlob(download: { blob: Blob; filename: string }): void {
  const url = URL.createObjectURL(download.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = download.filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function createQueryPresenter(slug: () => string, id: () => string): QueryPresenter {
  const adapter = createRefreshable(() => adaptersModel.get(slug(), id()));
  const [sql, setSql] = createSignal("");
  const [mongo, setMongoSignal] = createSignal<MongoDraft>(EMPTY_MONGO);
  const [rowCap, setRowCap] = createSignal("500");
  const [result, setResult] = createSignal<QueryResult | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [saveName, setSaveName] = createSignal("");
  const saved = createRefreshable(() => dataModel.savedQueries(slug(), id()));
  const history = createRefreshable(() => dataModel.history(slug(), id()));
  const running = createRefreshable(() => dataModel.running(slug(), id()));
  const runQuery = async (
    staticSlug: string,
    staticId: string,
    body: QueryRequest
  ): Promise<void> => {
    try {
      setResult(await dataModel.query(staticSlug, staticId, body));
    } catch (cause: unknown) {
      // Deliberately the database's own words. A syntax error, a missing column, a permission
      // refusal: on this screen that text is the answer the person came for, not a leak. Do not
      // route it through `humanMessage`.
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
      history.refresh();
    }
  };
  const isMongo = (): boolean => adapter.value().engine === "mongodb";
  /**
   * Throws when the query the person is writing will not parse: bad JSON in a Mongo filter, an
   * operation the schema refuses. Every caller shows that message as it is, on purpose. This whole
   * screen exists to report what is wrong with a query, and a friendlier sentence would say less.
   */
  const request = (): QueryRequest => buildRequest(isMongo(), sql(), mongo(), rowCap());
  return {
    adapter,
    isMongo,
    sql,
    setSql,
    mongo,
    setMongo: (patch) => setMongoSignal((current) => ({ ...current, ...patch })),
    rowCap,
    setRowCap,
    result,
    error,
    busy,
    run: () => {
      setError(null);
      setBusy(true);
      let body: QueryRequest;
      try {
        body = request();
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setBusy(false);
        return Promise.resolve();
      }
      return runQuery(slug(), id(), body);
    },
    exportAs: (format) => {
      const staticSlug = slug();
      const staticId = id();
      let staticBody: QueryRequest;
      try {
        staticBody = request();
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : String(cause));
        return Promise.resolve();
      }
      // The row cap limits the on-screen preview only; an export runs the same query again
      // without it, up to the server's own row and byte budgets.
      delete staticBody.row_cap;
      return attempt(async () => {
        saveBlob(await dataModel.exportQuery(staticSlug, staticId, staticBody, format));
      });
    },
    saved,
    saveName,
    setSaveName,
    save: () => {
      const staticSlug = slug();
      const staticId = id();
      const staticName = saveName();
      let staticBody: JsonObject;
      try {
        staticBody = v.parse(v.record(v.string(), v.any()), request());
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : String(cause));
        return Promise.resolve();
      }
      delete staticBody["row_cap"];
      return attempt(async () => {
        await dataModel.saveQuery(staticSlug, staticId, staticName, staticBody);
        setSaveName("");
        saved.refresh();
        showToast("Query saved", "success");
      });
    },
    load: (query) => {
      const draft = draftOf(query.body);
      setSql(draft.sql);
      setMongoSignal(draft.mongo);
    },
    removeSaved: (queryId) => {
      const staticSlug = slug();
      const staticId = id();
      return attempt(async () => {
        await dataModel.removeSavedQuery(staticSlug, staticId, queryId);
        saved.refresh();
      });
    },
    history,
    running,
    cancel: (queryId) => {
      const staticSlug = slug();
      const staticId = id();
      return attempt(async () => {
        await dataModel.cancel(staticSlug, staticId, queryId);
        showToast("Query cancelled.", "info");
        running.refresh();
      });
    },
  };
}

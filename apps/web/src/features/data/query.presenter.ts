import { createEffect, createSignal } from "solid-js";
import type { EditorLanguage } from "@/components/code-editor.tsx";
import type {
  Adapter,
  Introspection,
  JsonObject,
  QueryRequest,
  QueryResult,
} from "@testate/shared";
import * as v from "valibot";

import { attempt, showToast } from "@/lib/toast.ts";
import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { adapterModel } from "../adapter/adapter.model.ts";
import { adaptersModel } from "../adapters/adapters.model.ts";
import { dataModel } from "./data.model.ts";
import type { HistoryRow, RunningQuery, SavedQuery } from "./data.model.ts";
import {
  EMPTY_MONGO,
  buildRequest,
  draftOf,
  draftOfText,
  mongoSample,
  saveBlob,
} from "./query.draft.ts";
import type { Draft, MongoDraft } from "./query.draft.ts";

export type QueryPresenter = {
  adapter: Refreshable<Adapter>;
  isMongo: () => boolean;
  sql: () => string;
  setSql: (text: string) => void;
  /** Fills the console with a query against the adapter's first table or collection. */
  sample: () => Promise<void>;
  mongo: () => MongoDraft;
  setMongo: (patch: Partial<MongoDraft>) => void;
  /** SQL in the engine's dialect, completing the adapter's tables once the schema has loaded. */
  sqlLanguage: () => EditorLanguage;
  /** JSON, completing operators on `$` and the chosen collection's fields on a bare word. */
  mongoLanguage: () => EditorLanguage;
  /** The collection names, for the datalist under the Collection field. */
  collections: () => string[];
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
  /** A saved query into the editor, and run: a click on it is a call of it. */
  load: (query: SavedQuery) => Promise<void>;
  /** A past run back in the editor and run again, SQL text or the Mongo operation stored as JSON. */
  loadHistory: (row: HistoryRow) => Promise<void>;
  removeSaved: (id: string) => Promise<void>;
  history: Refreshable<HistoryRow[]>;
  running: Refreshable<RunningQuery[]>;
  cancel: (queryId: string) => Promise<void>;
};

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
  // Completion data arrives beside the console, never in front of it: an effect into a signal
  // rather than an async memo, so the editor renders while the schema is still on its way.
  const [schema, setSchema] = createSignal<Introspection | null>(null);
  const loadSchema = async (staticSlug: string, staticId: string): Promise<void> => {
    try {
      setSchema(await adapterModel.schema(staticSlug, staticId));
    } catch {
      setSchema(null);
    }
  };
  createEffect(
    () => ({ staticSlug: slug(), staticId: id() }),
    ({ staticSlug, staticId }) => {
      void loadSchema(staticSlug, staticId);
    }
  );
  const collections = (): string[] => (schema()?.tables ?? []).map((table) => table.name);
  const [fields, setFields] = createSignal<readonly string[]>([]);
  let fieldsRequest = 0;
  const loadFields = async (
    staticSlug: string,
    staticId: string,
    name: string,
    request: number
  ): Promise<void> => {
    try {
      const page = await dataModel.rows(staticSlug, staticId, name, {
        limit: 25,
        order: "asc",
        filter: [],
      });
      if (request !== fieldsRequest) return;
      setFields(page.columns.map((column) => column.name).filter((n) => !n.startsWith("$")));
    } catch {
      setFields([]);
    }
  };
  // Fields come from a page of documents, once the typed name is a collection and not a prefix of
  // one. The counter drops an answer for a name that was typed over while it was in flight.
  createEffect(
    () => ({
      staticSlug: slug(),
      staticId: id(),
      name: mongo().collection,
      known: isMongo() && collections().includes(mongo().collection),
    }),
    ({ staticSlug, staticId, name, known }) => {
      const request = ++fieldsRequest;
      if (known) void loadFields(staticSlug, staticId, name, request);
      else setFields([]);
    }
  );
  /**
   * Throws when the query the person is writing will not parse: bad JSON in a Mongo filter, an
   * operation the schema refuses. Every caller shows that message as it is, on purpose. This whole
   * screen exists to report what is wrong with a query, and a friendlier sentence would say less.
   */
  const request = (): QueryRequest => buildRequest(isMongo(), sql(), mongo(), rowCap());
  const run = (): Promise<void> => {
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
  };
  const take = (draft: Draft): Promise<void> => {
    setSql(draft.sql);
    setMongoSignal(draft.mongo);
    return run();
  };
  return {
    adapter,
    sample: async () => {
      const staticSlug = slug();
      const staticId = id();
      await attempt(async () => {
        const schema = await adapterModel.schema(staticSlug, staticId);
        const first = schema.tables[0];
        if (first === undefined) throw new Error("This adapter has no tables to sample yet.");
        const name = first.schema === null ? first.name : `${first.schema}.${first.name}`;
        if (adapter.value().engine === "mongodb") {
          const page = await dataModel.rows(staticSlug, staticId, first.name, {
            limit: 25,
            order: "asc",
            filter: [],
          });
          setMongoSignal(
            mongoSample(
              first.name,
              page.columns.map((column) => column.name)
            )
          );
        } else {
          setSql(`SELECT *\nFROM ${name}\nORDER BY 1\nLIMIT 20`);
        }
      });
    },

    isMongo,
    sql,
    setSql,
    mongo,
    setMongo: (patch) => setMongoSignal((current) => ({ ...current, ...patch })),
    sqlLanguage: () => ({ kind: "sql", engine: adapter.value().engine, schema: schema() }),
    mongoLanguage: () => ({ kind: "json", fields: fields() }),
    collections,
    rowCap,
    setRowCap,
    result,
    error,
    busy,
    run,
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
    load: (query) => take(draftOf(query.body)),
    loadHistory: (row) => take(draftOfText(row.query_text)),
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

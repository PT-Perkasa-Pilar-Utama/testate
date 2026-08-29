import * as v from "valibot";
import type { Fixture, JsonObject, WriteSession } from "@testate/shared";
import { fixtureSchema, rowEditsResultSchema, writeSessionSchema } from "@testate/shared";

import { apiClient } from "@/lib/api-client.ts";

export type RowEditsResult = v.InferOutput<typeof rowEditsResultSchema>;
export type FixtureOptions = {
  depth: number;
  direction: "parents" | "children" | "both";
  format: "sql" | "json";
};

const adapterPath = (slug: string, id: string): string =>
  `/projects/${encodeURIComponent(slug)}/adapters/${encodeURIComponent(id)}`;

export const editingModel = {
  startSession: (slug: string, id: string, foreignKeyChecks: boolean): Promise<WriteSession> =>
    apiClient.post(`${adapterPath(slug, id)}/write-sessions`, {
      schema: writeSessionSchema,
      body: { foreign_key_checks: foreignKeyChecks },
    }),
  setForeignKeyChecks: (
    slug: string,
    id: string,
    sessionId: string,
    foreignKeyChecks: boolean
  ): Promise<WriteSession> =>
    apiClient.patch(`${adapterPath(slug, id)}/write-sessions/${encodeURIComponent(sessionId)}`, {
      schema: writeSessionSchema,
      body: { foreign_key_checks: foreignKeyChecks },
    }),
  endSession: (slug: string, id: string, sessionId: string): Promise<undefined> =>
    apiClient.delete(`${adapterPath(slug, id)}/write-sessions/${encodeURIComponent(sessionId)}`, {
      schema: v.undefined(),
    }),
  rowEdits: (
    slug: string,
    id: string,
    table: string,
    sessionId: string,
    edits: JsonObject[]
  ): Promise<RowEditsResult> =>
    apiClient.post(`${adapterPath(slug, id)}/tables/${encodeURIComponent(table)}/row-edits`, {
      schema: rowEditsResultSchema,
      body: { write_session_id: sessionId, edits },
    }),
  fixture: (
    slug: string,
    id: string,
    table: string,
    pk: JsonObject,
    options: FixtureOptions
  ): Promise<Fixture> =>
    apiClient.post(`${adapterPath(slug, id)}/fixture`, {
      schema: fixtureSchema,
      body: { table, pk, ...options },
    }),
};

import * as v from "valibot";
import type { ErrorCode, JsonObject } from "@testate/shared";
import { apiErrorSchema } from "@testate/shared";

/** Vite fills `BASE_URL`; under `bun test` there is no env, so the root serves as the base. */
const API = `${(import.meta.env?.BASE_URL ?? "/").replace(/\/$/, "")}/api/v1`;

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: JsonObject | undefined;

  constructor(code: ErrorCode, status: number, message: string, details?: JsonObject) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export type Query = Record<string, string | number | boolean | undefined>;

type RequestOptions<TSchema extends v.GenericSchema> = {
  query?: Query;
  schema: TSchema;
  body?: JsonObject;
};

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

function toQuery(query: Query | undefined): string {
  if (query === undefined) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

async function parseError(response: Response): Promise<ApiError> {
  const parsed = v.safeParse(apiErrorSchema, await response.json().catch(() => null));
  if (parsed.success) {
    const { code, message, details } = parsed.output.error;
    return new ApiError(code, response.status, message, details);
  }
  return new ApiError("INTERNAL", response.status, `request failed with ${response.status}`);
}

function buildInit(method: Method, body: JsonObject | undefined): RequestInit {
  const headers = new Headers({ Accept: "application/json" });
  if (method !== "GET") headers.set("X-Testate-Request", "1");
  if (body === undefined || method === "GET")
    return { method, headers, credentials: "same-origin" };
  headers.set("Content-Type", "application/json");
  return { method, headers, credentials: "same-origin", body: JSON.stringify(body) };
}

/** The only place the SPA calls fetch. Unwraps `{ data }`, parses it, throws ApiError. */
async function request<TSchema extends v.GenericSchema>(
  method: Method,
  path: string,
  options: RequestOptions<TSchema>
): Promise<v.InferOutput<TSchema>> {
  const response = await fetch(
    `${API}${path}${toQuery(options.query)}`,
    buildInit(method, options.body)
  );
  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return v.parse(options.schema, undefined);
  const envelope = v.safeParse(v.object({ data: options.schema }), await response.json());
  if (!envelope.success)
    throw new ApiError("INTERNAL", response.status, "response did not match its contract");
  return envelope.output.data;
}

/** Reads the whole body when the response is a page envelope (`{ data, page, ... }`). */
async function envelope<TSchema extends v.GenericSchema>(
  path: string,
  options: RequestOptions<TSchema>
): Promise<v.InferOutput<TSchema>> {
  const response = await fetch(
    `${API}${path}${toQuery(options.query)}`,
    buildInit("GET", undefined)
  );
  if (!response.ok) throw await parseError(response);
  const parsed = v.safeParse(options.schema, await response.json());
  if (!parsed.success)
    throw new ApiError("INTERNAL", response.status, "response did not match its contract");
  return parsed.output;
}

export type Download = { blob: Blob; filename: string };

/** A streamed file from a POST; the name comes from `Content-Disposition`. */
async function download(path: string, body: JsonObject, fallback: string): Promise<Download> {
  const response = await fetch(`${API}${path}`, buildInit("POST", body));
  if (!response.ok) throw await parseError(response);
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallback;
  return { blob: await response.blob(), filename };
}

/** A full API URL for links the browser follows itself (downloads, framed previews). */
function url(path: string, query?: Query): string {
  return `${API}${path}${toQuery(query)}`;
}

export const apiClient = {
  envelope,
  download,
  url,
  get: <TSchema extends v.GenericSchema>(
    path: string,
    options: RequestOptions<TSchema>
  ): Promise<v.InferOutput<TSchema>> => request("GET", path, options),
  post: <TSchema extends v.GenericSchema>(
    path: string,
    options: RequestOptions<TSchema>
  ): Promise<v.InferOutput<TSchema>> => request("POST", path, options),
  put: <TSchema extends v.GenericSchema>(
    path: string,
    options: RequestOptions<TSchema>
  ): Promise<v.InferOutput<TSchema>> => request("PUT", path, options),
  patch: <TSchema extends v.GenericSchema>(
    path: string,
    options: RequestOptions<TSchema>
  ): Promise<v.InferOutput<TSchema>> => request("PATCH", path, options),
  delete: <TSchema extends v.GenericSchema>(
    path: string,
    options: RequestOptions<TSchema>
  ): Promise<v.InferOutput<TSchema>> => request("DELETE", path, options),
};

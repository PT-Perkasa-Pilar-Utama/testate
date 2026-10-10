import * as v from "valibot";

import { logFormatSchema, logSourceNameSchema, safePatternSchema } from "./logs.ts";

/**
 * The `loki` log engine (#90; L1–L8 of docs/decisions/2026-10-10-loki.md): a Loki or Grafana Cloud
 * instance, read with LogQL log queries through `query_range`.
 */

export const LOKI_QUERY_MAX = 2000;

/** A LogQL log query: a stream selector first. A metric query is refused when Loki answers (L3). */
export const lokiQuerySchema = v.pipe(
  v.string(),
  v.trim(),
  v.startsWith("{", 'A log query starts with a stream selector, like {service="api"}.'),
  v.maxLength(LOKI_QUERY_MAX, `Keep the query to ${LOKI_QUERY_MAX} characters.`)
);

export const lokiSourceSchema = v.pipe(
  v.object({
    name: logSourceNameSchema,
    query: lokiQuerySchema,
    format: v.optional(logFormatSchema, "plain"),
    regex: v.optional(safePatternSchema),
    patterns: v.optional(v.array(safePatternSchema), []),
  }),
  v.check(
    (source) => source.format !== "regex" || source.regex !== undefined,
    "The regex format needs a pattern."
  )
);
export type LokiSource = v.InferOutput<typeof lokiSourceSchema>;

/** `http(s)://host[:port][/prefix]`: no login in the URL, no query, no fragment (L1). */
export const BASE_URL = /^https?:\/\/[^\s/?#@]+(\/[^\s?#@]*)?$/;

/** The address rule, shared with the dialog so a typo is named before the API sees it. */
export const lokiUrlSchema = v.pipe(
  v.string(),
  v.trim(),
  v.maxLength(512),
  v.regex(BASE_URL, "Enter Loki's address, like https://logs.example.com, with no login in it.")
);

/** Sent as `X-Scope-OrgID` to a Loki that runs with several tenants. */
export const lokiTenantSchema = v.pipe(
  v.string(),
  v.regex(/^[A-Za-z0-9_.-]{1,150}$/, "A tenant holds letters, digits and _ . - only.")
);

export const LOKI_AUTHS = ["none", "basic", "bearer"] as const;

export const lokiConfigSchema = v.pipe(
  v.object({
    url: lokiUrlSchema,
    auth: v.optional(v.picklist(LOKI_AUTHS), "none"),
    user: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(256))),
    tenant: v.optional(lokiTenantSchema),
    sources: v.pipe(
      v.array(lokiSourceSchema),
      v.minLength(1, "Add at least one source."),
      v.maxLength(32),
      v.check(
        (sources) => new Set(sources.map((source) => source.name)).size === sources.length,
        "Each source needs its own name."
      )
    ),
  }),
  v.check(
    (config) => config.auth !== "basic" || config.user !== undefined,
    "Basic auth needs a user."
  )
);
export type LokiConfig = v.InferOutput<typeof lokiConfigSchema>;

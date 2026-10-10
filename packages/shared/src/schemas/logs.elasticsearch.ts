import * as v from "valibot";

import { BASE_URL } from "./logs.loki.ts";
import { logSourceNameSchema, safePatternSchema } from "./logs.ts";

/**
 * The `elasticsearch` log engine (#92; E1–E8 of docs/decisions/2026-10-10-elasticsearch.md): an
 * Elasticsearch or OpenSearch cluster, read with `_search` on an index pattern.
 */

/** One index pattern: no leading `-` (an exclusion) or `_` (`_all`, a system index) (E2). */
export const ES_INDEX_PART = /^[a-z0-9*][a-z0-9*._+-]{0,254}$/;
/** A field name as a shipper writes it, dotted or not (E3). */
export const ES_FIELD = /^[A-Za-z0-9_@][A-Za-z0-9_.@-]{0,254}$/;
export const ES_QUERY_MAX = 2000;

export const esIndexSchema = v.pipe(
  v.string(),
  v.trim(),
  v.check((index) => {
    const parts = index.split(",").map((part) => part.trim());
    return (
      parts.length >= 1 && parts.length <= 8 && parts.every((part) => ES_INDEX_PART.test(part))
    );
  }, "Up to 8 index patterns, comma-separated, of lowercase letters, digits, * . _ + -, not starting with - or _.")
);

export const esFieldSchema = v.pipe(
  v.string(),
  v.trim(),
  v.regex(ES_FIELD, "A field name holds letters, digits and _ . @ - only.")
);

export const esSourceSchema = v.object({
  name: logSourceNameSchema,
  index: esIndexSchema,
  /** A Lucene `query_string`; empty matches every document. */
  query: v.optional(
    v.pipe(
      v.string(),
      v.trim(),
      v.maxLength(ES_QUERY_MAX, `Keep the query to ${ES_QUERY_MAX} characters.`)
    ),
    ""
  ),
  time_field: v.optional(esFieldSchema, "@timestamp"),
  message_field: v.optional(esFieldSchema, "message"),
  patterns: v.optional(v.array(safePatternSchema), []),
});
export type EsSource = v.InferOutput<typeof esSourceSchema>;

/** The address rule, shared with the dialog so a typo is named before the API sees it. */
export const esUrlSchema = v.pipe(
  v.string(),
  v.trim(),
  v.maxLength(512),
  v.regex(
    BASE_URL,
    "Enter the cluster's address, like https://es.example.com:9200, with no login in it."
  )
);

export const ES_AUTHS = ["none", "basic", "api_key", "bearer"] as const;

const pem = v.pipe(
  v.string(),
  v.maxLength(16 * 1024),
  v.startsWith("-----BEGIN ", "Paste the CA in PEM form.")
);

export const esConfigSchema = v.pipe(
  v.object({
    url: esUrlSchema,
    auth: v.optional(v.picklist(ES_AUTHS), "none"),
    user: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(256))),
    /** The CA a self-signed cluster's certificate is checked against. */
    tls_ca: v.optional(pem),
    sources: v.pipe(
      v.array(esSourceSchema),
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
export type EsConfig = v.InferOutput<typeof esConfigSchema>;

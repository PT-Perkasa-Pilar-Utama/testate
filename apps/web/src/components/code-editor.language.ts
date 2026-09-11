import type { CompletionSource } from "@codemirror/autocomplete";
import { json } from "@codemirror/lang-json";
import { MariaSQL, MySQL, PostgreSQL, sql } from "@codemirror/lang-sql";
import type { SQLDialect, SQLNamespace } from "@codemirror/lang-sql";
import type { LanguageSupport } from "@codemirror/language";
import type { Engine, Introspection } from "@testate/shared";

/** What an editor speaks, as data: the CodeMirror objects are built where the chunk is loaded. */
export type EditorLanguage =
  | { kind: "sql"; engine: Engine; schema: Introspection | null }
  | { kind: "json"; fields: readonly string[] };

/** The stages and operators a person reaches for in a filter or a pipeline, offered on `$`. */
export const MONGO_OPERATORS: readonly string[] = [
  "$match",
  "$group",
  "$project",
  "$sort",
  "$limit",
  "$skip",
  "$unwind",
  "$lookup",
  "$count",
  "$addFields",
  "$set",
  "$unset",
  "$replaceRoot",
  "$facet",
  "$bucket",
  "$sample",
  "$sortByCount",
  "$eq",
  "$ne",
  "$gt",
  "$gte",
  "$lt",
  "$lte",
  "$in",
  "$nin",
  "$and",
  "$or",
  "$not",
  "$nor",
  "$exists",
  "$type",
  "$regex",
  "$options",
  "$elemMatch",
  "$size",
  "$all",
  "$sum",
  "$avg",
  "$min",
  "$max",
  "$first",
  "$last",
  "$push",
  "$addToSet",
];

const DIALECTS = new Map<Engine, SQLDialect>([
  ["postgres", PostgreSQL],
  ["mysql", MySQL],
  ["mariadb", MariaSQL],
]);

export type SqlNamespace = { namespace: SQLNamespace; defaultSchema: string | undefined };

/**
 * The adapter's tables as lang-sql wants them: under their schema where the engine has one, so
 * `public.users` completes, with the first schema as the default so bare `users` does too. A view
 * is a name with no columns; the introspection does not carry them.
 */
export function sqlNamespaceOf(schema: Introspection): SqlNamespace {
  const flat: Record<string, readonly string[]> = {};
  const grouped: Record<string, Record<string, readonly string[]>> = {};
  const place = (owner: string | null, name: string, columns: readonly string[]): void => {
    if (owner === null) flat[name] = columns;
    else (grouped[owner] ??= {})[name] = columns;
  };
  for (const table of schema.tables) {
    place(
      table.schema,
      table.name,
      table.columns.map((column) => column.name)
    );
  }
  for (const view of schema.views) place(view.schema, view.name, []);
  const namespace: SQLNamespace = { ...flat, ...grouped };
  return { namespace, defaultSchema: schema.tables[0]?.schema ?? undefined };
}

/** SQL for the engine's dialect, with the adapter's tables once they are known. */
export function sqlSupport(engine: Engine, schema: Introspection | null): LanguageSupport {
  const dialect = DIALECTS.get(engine);
  if (schema === null) return sql({ ...(dialect && { dialect }), upperCaseKeywords: true });
  const { namespace, defaultSchema } = sqlNamespaceOf(schema);
  return sql({
    ...(dialect && { dialect }),
    schema: namespace,
    ...(defaultSchema !== undefined && { defaultSchema }),
    upperCaseKeywords: true,
  });
}

/**
 * Completes a `$` word with an operator and a bare word with a field of the chosen collection.
 * JSON has no word of its own to complete, so this replaces the language's list rather than
 * adding to it.
 */
export function mongoCompletions(fields: readonly string[]): CompletionSource {
  return (context) => {
    const word = context.matchBefore(/[$\w.]*/);
    if (word === null || (word.from === word.to && !context.explicit)) return null;
    const options = word.text.startsWith("$")
      ? MONGO_OPERATORS.map((label) => ({ label, type: "keyword" }))
      : fields.map((label) => ({ label, type: "property" }));
    return { from: word.from, options, validFor: /^[$\w.]*$/ };
  };
}

export type BuiltLanguage = { support: LanguageSupport; completions: CompletionSource | undefined };

/** The language support and, for JSON, the completion source that replaces its own. */
export function languageOf(spec: EditorLanguage): BuiltLanguage {
  if (spec.kind === "sql") {
    return { support: sqlSupport(spec.engine, spec.schema), completions: undefined };
  }
  return { support: json(), completions: mongoCompletions(spec.fields) };
}

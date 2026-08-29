import { AppError } from "../../lib/http/index.ts";

const PLACEHOLDER = /\{\{([a-z]+\.[a-z_]+)\}\}/g;
const KNOWN = new Set(["project.slug", "state.name", "state.id", "job.id"]);

/** What a run knows about its surroundings (10 §10.4); missing parts expand to an empty string. */
export type Placeholders = {
  project: { slug: string };
  state?: { id: string; name: string };
  job?: { id: string };
};

/** Rejects unknown placeholders at save time; known ones expand at run time. */
export function checkPlaceholders(text: string): void {
  for (const match of text.matchAll(PLACEHOLDER)) {
    const name = match[1] ?? "";
    if (!KNOWN.has(name)) throw new AppError("VALIDATION_ERROR", `unknown placeholder {{${name}}}`);
  }
}

const GETTERS = new Map<string, (ctx: Placeholders) => string>([
  ["project.slug", (ctx) => ctx.project.slug],
  ["state.name", (ctx) => ctx.state?.name ?? ""],
  ["state.id", (ctx) => ctx.state?.id ?? ""],
  ["job.id", (ctx) => ctx.job?.id ?? ""],
]);

function valueOf(name: string, ctx: Placeholders): string {
  const getter = GETTERS.get(name);
  if (getter === undefined)
    throw new AppError("VALIDATION_ERROR", `unknown placeholder {{${name}}}`);
  return getter(ctx);
}

export function expand(text: string, ctx: Placeholders): string {
  return text.replace(PLACEHOLDER, (_match, name: string) => valueOf(name, ctx));
}

/** Header, query, and secret maps share this shape. */
export type StringMap = Record<string, string>;

/** Every value expanded; callers rebuild the map with `Object.fromEntries`. */
export function expandEntries(map: StringMap, ctx: Placeholders): [string, string][] {
  return Object.entries(map).map(([key, value]) => [key, expand(value, ctx)]);
}

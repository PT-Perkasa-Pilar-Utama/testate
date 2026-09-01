import { slugify } from "cizgile";

/**
 * The slug a project gets from its name.
 *
 * One implementation for both sides on purpose: the dialog shows the slug before you submit and the
 * API decides the one you keep, and a person who sees `cafe-munchen` and gets `caf-m-nchen` has
 * been lied to. `cizgile` transliterates rather than deletes, which is the whole difference:
 * `Café München` reads as `cafe-munchen` instead of `caf-m-nchen`.
 *
 * ASCII only, because `slugSchema` is `[a-z0-9-]`. A name written in a script that has no
 * transliteration table (Cyrillic, Japanese) therefore slugs to nothing, and the fallback names it
 * `project`, which the collision suffix then makes unique. The alternative, a Unicode slug, would
 * be refused by the pattern every other caller validates against.
 */
export const SLUG_FALLBACK = "project";

/** The base leaves room for a `-2` suffix inside `slugSchema`'s 64. */
const BASE_MAX = 40;
const MIN = 2;

/** Words a project may not take, because a route already answers to them. */
export const RESERVED_SLUGS: readonly string[] = ["defaults"];

export function projectSlug(name: string): string {
  const slug = slugify(name, { maxLength: BASE_MAX });
  return slug.length < MIN ? SLUG_FALLBACK : slug;
}

/**
 * The first free slug in `base`, `base-2`, `base-3`. `taken` answers for the whole table, so the
 * caller must run this and the insert without an await between them, or two requests racing for the
 * same name both see the slug free.
 */
export function freeSlug(base: string, taken: (slug: string) => boolean): string {
  const reserved = (slug: string): boolean => RESERVED_SLUGS.includes(slug) || taken(slug);
  if (!reserved(base)) return base;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!reserved(candidate)) return candidate;
  }
  throw new Error(`no free slug for ${base}`);
}

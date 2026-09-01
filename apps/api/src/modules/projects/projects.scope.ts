import type { MiddlewareHandler } from "hono";

import { notFound } from "../../lib/http/index.ts";

/** All this middleware asks of a repository: a slug, and the id behind it. */
export type SlugLookup = { bySlug(slug: string): { id: string } | null };

/**
 * A project-scoped token sees only its projects: any `/projects/:slug/**` outside the scope
 * answers 404, so existence is not revealed (09 §9.5). Users and unscoped tokens pass.
 */
export function requireProjectInScope(repo: SlugLookup): MiddlewareHandler {
  return async (c, next) => {
    const scope = c.get("projectScope");
    if (scope !== null) {
      const slug = c.req.param("slug");
      const project = slug === undefined ? null : repo.bySlug(slug);
      if (project === null || !scope.includes(project.id)) throw notFound("project");
    }
    await next();
  };
}

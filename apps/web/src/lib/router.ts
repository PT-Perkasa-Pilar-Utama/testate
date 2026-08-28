import { createMemo, createSignal } from "solid-js";
import type { Role } from "@testate/shared";

// ponytail: in-house history router. Swap for @solidjs/router when its Solid 2 line ships stable.

export type RouteParams = Record<string, string>;

export type RouteDef<TName extends string = string> = {
  name: TName;
  pattern: string;
  role: Role | null;
};

export type Match = { name: string; params: RouteParams; path: string };

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(pathname: string): string {
  const path = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname;
  return path === "" ? "/" : path;
}

const [location, setLocation] = createSignal(stripBase(window.location.pathname));

window.addEventListener("popstate", () => setLocation(stripBase(window.location.pathname)));

/** Navigates to an app-relative path and updates history. */
export function navigate(path: string, replace = false): void {
  const url = `${BASE}${path}`;
  if (replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
  setLocation(path);
}

/** Builds an href for anchors so middle-click and copy work. */
export function href(path: string): string {
  return `${BASE}${path}`;
}

type Compiled = { regex: RegExp; keys: string[] };

function compile(pattern: string): Compiled {
  const keys: string[] = [];
  const source = pattern
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) {
        keys.push(segment.slice(1));
        return "([^/]+)";
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { regex: new RegExp(`^${source}/?$`), keys };
}

/** Matches the current location against a route table; the memo re-runs on navigation. */
export function createMatcher(routes: readonly RouteDef[]): () => Match | null {
  const compiled = routes.map((route) => ({ route, ...compile(route.pattern) }));
  return createMemo((): Match | null => {
    const path = location();
    for (const { route, regex, keys } of compiled) {
      const found = regex.exec(path);
      if (found === null) continue;
      const params: RouteParams = {};
      keys.forEach((key, index) => {
        params[key] = decodeURIComponent(found[index + 1] ?? "");
      });
      return { name: route.name, params, path };
    }
    return null;
  });
}

export { location };

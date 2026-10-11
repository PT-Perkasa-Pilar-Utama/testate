/**
 * `hono/cookie` for the demo (#demo). A page cannot put a `Cookie` header on a Request it builds,
 * and a Response it builds drops `Set-Cookie`, so the session cookie lives here instead: one jar
 * for the tab, which is the one browser the demo has.
 */
import type { Context } from "hono";

const jar = new Map<string, string>();

type CookieOptions = { maxAge?: number; expires?: Date; path?: string };

export function getCookie(context: Context): Record<string, string>;
export function getCookie(context: Context, key: string): string | undefined;
export function getCookie(
  _context: Context,
  key?: string
): Record<string, string> | string | undefined {
  return key === undefined ? Object.fromEntries(jar) : jar.get(key);
}

export function setCookie(
  _context: Context,
  name: string,
  value: string,
  options?: CookieOptions
): void {
  const expired =
    options?.maxAge === 0 ||
    (options?.expires !== undefined && options.expires.getTime() <= Date.now());
  if (expired) jar.delete(name);
  else jar.set(name, value);
}

export function deleteCookie(
  _context: Context,
  name: string,
  _options?: CookieOptions
): string | undefined {
  const value = jar.get(name);
  jar.delete(name);
  return value;
}

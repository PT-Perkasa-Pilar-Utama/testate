import type { Engine } from "@testate/shared";

import { ENGINE_FORMS } from "./adapters.fields.ts";
import type { Field, Values } from "./adapters.fields.ts";

/** What a scheme in a connection string means here. `postgres` and `postgresql` are both common,
 * and `s3` is absent because a bucket is not a URL. A Map, so an unknown scheme is a miss and not
 * a stray property. */
const SCHEMES = new Map([
  ["postgres", "postgres"],
  ["postgresql", "postgres"],
  ["mysql", "mysql"],
  ["mariadb", "mariadb"],
  ["mongodb", "mongodb"],
  ["mongodb+srv", "mongodb"],
  ["sftp", "sftp"],
  ["ftp", "ftp"],
] satisfies [string, Engine][]);

export type ParsedUrl = { engine: Engine; values: Values };

/**
 * A connection string, taken apart into the fields the form already has.
 *
 * Everyone has one of these in a `.env` or a password manager, and typing it back out field by
 * field is where the typo comes from. `s3` is absent on purpose: a bucket, a region and a key pair
 * are not a URL, so there is nothing to take apart.
 *
 * Returns null rather than throwing. Someone is typing, and half a URL is not an error yet.
 */
export function parseConnectionUrl(raw: string): ParsedUrl | null {
  const text = raw.trim();
  if (text === "") return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const engine = SCHEMES.get(url.protocol.replace(/:$/, "").toLowerCase());
  if (engine === undefined || url.hostname === "") return null;
  const values: Values = { host: url.hostname };
  if (url.port !== "") values["port"] = url.port;
  if (url.username !== "") values["user"] = decodeURIComponent(url.username);
  if (url.password !== "") values["password"] = decodeURIComponent(url.password);
  // The path is the database name for a database, and the folder to start in for a file store.
  const path = decodeURIComponent(url.pathname).replace(/^\//, "");
  const pathKey = ENGINE_FORMS[engine].kind === "database" ? "database" : "root_path";
  if (path !== "") values[pathKey] = path;
  return { engine, values };
}

/** Every field a URL speaks for. A second paste must not leave the first one's port behind. */
const URL_KEYS = ["host", "port", "user", "password", "database", "root_path"];

/** The parsed URL, keyed the way the form holds it, and blank wherever the URL says nothing. */
export function urlPatch(parsed: ParsedUrl): Values {
  const patch: Values = {};
  const take = (prefix: string, fields: readonly Field[]): void => {
    for (const field of fields) {
      if (!URL_KEYS.includes(field.key)) continue;
      patch[`${prefix}.${field.key}`] = parsed.values[field.key] ?? "";
    }
  };
  take("config", ENGINE_FORMS[parsed.engine].config);
  take("secret", ENGINE_FORMS[parsed.engine].secrets);
  return patch;
}

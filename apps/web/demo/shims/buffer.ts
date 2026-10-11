/**
 * `Buffer` for the demo (#demo): the buffer package, plus the `base64url` encoding it predates,
 * which the API's tokens and cursors use.
 */
import { Buffer } from "buffer";
import * as v from "valibot";

const toBase64Url = (base64: string): string =>
  base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64Url = (text: string): string => text.replace(/-/g, "+").replace(/_/g, "/");

const base64UrlCall = v.tuple([v.string(), v.literal("base64url")]);
const encodingSchema = v.optional(
  v.picklist([
    "ascii",
    "utf8",
    "utf-8",
    "utf16le",
    "ucs2",
    "ucs-2",
    "base64",
    "latin1",
    "binary",
    "hex",
  ])
);

const toString = Buffer.prototype.toString;
Buffer.prototype.toString = function (
  this: Buffer,
  encoding?: string,
  start?: number,
  end?: number
): string {
  if (encoding === "base64url") return toBase64Url(toString.call(this, "base64", start, end));
  return toString.call(this, v.parse(encodingSchema, encoding), start, end);
};

type FromArgument = string | number | ArrayBuffer | Uint8Array | readonly number[] | undefined;
type From = (...args: FromArgument[]) => Buffer;
// SAFETY: every Buffer.from overload takes some list of FromArgument values and returns a Buffer.
const from = Buffer.from.bind(Buffer) as From;

function patchedFrom(...args: FromArgument[]): Buffer {
  if (v.is(base64UrlCall, args)) return from(fromBase64Url(args[0]), "base64");
  return from(...args);
}

// SAFETY: patchedFrom takes every argument list Buffer.from takes and hands all but a base64url
// string straight to it, so its overloads still describe the function.
Buffer.from = patchedFrom as typeof Buffer.from;

export { Buffer };

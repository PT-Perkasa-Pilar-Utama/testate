import type { Hono, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";

import { AppError } from "./errors.ts";

/** A policy as directive → sources, rendered the way the header wants it. */
function policy(directives: { [directive: string]: string[] }): string {
  return Object.entries(directives)
    .map(([directive, sources]) => `${directive} ${sources.join(" ")}`)
    .join("; ");
}

/**
 * The dashboard's policy (07 §7.5). It loads scripts, styles, fonts and data from itself and
 * nothing else; `'unsafe-inline'` on styles is for the style attributes Solid writes, and
 * `frame-src 'self'` is for the sandboxed preview of a stored file, which the preview route
 * locks down with a policy of its own.
 */
const APP_CSP = policy({
  "default-src": ["'self'"],
  "script-src": ["'self'"],
  "style-src": ["'self'", "'unsafe-inline'"],
  "img-src": ["'self'", "data:", "blob:"],
  "font-src": ["'self'"],
  "connect-src": ["'self'"],
  "frame-src": ["'self'"],
  "frame-ancestors": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
  "object-src": ["'none'"],
});

/**
 * The API reference is Scalar's bundle from jsdelivr with its configuration inline, so that one
 * page allows both. It sits behind a session, and vendoring the bundle to close the gap would
 * mean shipping a copy of a viewer that changes every week.
 */
const DOCS_CSP = policy({
  "default-src": ["'self'"],
  "script-src": ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
  "style-src": [
    "'self'",
    "'unsafe-inline'",
    "https://cdn.jsdelivr.net",
    "https://fonts.googleapis.com",
  ],
  "font-src": ["'self'", "data:", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net"],
  "img-src": ["'self'", "data:", "https:"],
  "connect-src": ["'self'"],
  "frame-ancestors": ["'none'"],
  "base-uri": ["'self'"],
  "object-src": ["'none'"],
});

export type HeaderOptions = {
  /** Behind a TLS-terminating proxy, the same flag that makes the session cookie `Secure`. */
  hsts: boolean;
  /** `/api/v1` or `/<base>/api/v1`: answers under it are never cached. */
  apiPrefix: string;
};

/**
 * Every response leaves with the headers 07 §7.5 promises. The Content-Security-Policy is set
 * only where the handler set none, because the storage preview locks its own response down
 * harder than the dashboard's policy would, and a middleware that overwrote it would loosen the
 * one path that renders someone else's bytes.
 */
export function securityHeaders(options: HeaderOptions): MiddlewareHandler {
  const base = secureHeaders({
    strictTransportSecurity: options.hsts ? "max-age=31536000; includeSubDomains" : false,
    xFrameOptions: "DENY",
    referrerPolicy: "no-referrer",
    crossOriginOpenerPolicy: "same-origin",
    permissionsPolicy: { camera: [], microphone: [], geolocation: [], payment: [], usb: [] },
  });
  return async (c, next) => {
    await base(c, next);
    const headers = c.res.headers;
    if (!headers.has("content-security-policy")) {
      const docs = c.req.path === `${options.apiPrefix}/docs`;
      headers.set("content-security-policy", docs ? DOCS_CSP : APP_CSP);
    }
    if (c.req.path.startsWith(`${options.apiPrefix}/`) && !headers.has("cache-control")) {
      headers.set("cache-control", "no-store");
    }
  };
}

export type HardeningOptions = HeaderOptions & { uploadBytes: number };

/** Both middlewares on the app, ahead of authentication, with the limits 07 §7.5 names. */
export function installHardening(app: Hono, options: HardeningOptions): void {
  const mib = 1024 * 1024;
  app.use("*", securityHeaders(options));
  app.use(
    `${options.apiPrefix}/*`,
    // A mebibyte over the upload cap, for the multipart boundary and the fields beside the file.
    bodyLimits({ json: mib, mcp: 2 * mib, upload: options.uploadBytes + mib })
  );
}

export type BodyLimits = {
  /** JSON bodies: a settings patch, a query, a login. */
  json: number;
  /** `/mcp`: an agent's file arrives base64 inside the JSON-RPC arguments (23 §23.6). */
  mcp: number;
  /** Multipart uploads: an import file, a stored file, a state archive. */
  upload: number;
};

/**
 * Refuses a body before it is read (07 §7.5). A `Content-Length` over the cap answers at once;
 * a chunked body is counted as it streams and cut off at the cap. Either way the answer is the
 * 413 envelope, not Hono's plain-text one.
 */
export function bodyLimits(limits: BodyLimits): MiddlewareHandler {
  const limit = (maxSize: number): MiddlewareHandler =>
    bodyLimit({
      maxSize,
      onError: () => {
        throw new AppError("PAYLOAD_TOO_LARGE", "that request body is over the limit", {
          limit_bytes: maxSize,
        });
      },
    });
  const json = limit(limits.json);
  const mcp = limit(limits.mcp);
  const upload = limit(limits.upload);
  return (c, next) => {
    const multipart = (c.req.header("content-type") ?? "").startsWith("multipart/form-data");
    if (multipart) return upload(c, next);
    return c.req.path.endsWith("/mcp") ? mcp(c, next) : json(c, next);
  };
}

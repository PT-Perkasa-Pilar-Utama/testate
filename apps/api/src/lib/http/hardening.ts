import type { Hono, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";

import { authenticate, requestMeta, sessionCookieName } from "./auth.ts";
import type { ActorResolver } from "./auth.ts";
import { AppError, rateLimited } from "./errors.ts";
import { createRateLimiter } from "./ratelimit.ts";

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
 * Every response leaves with the headers 07 §7.5 promises. The Content-Security-Policy and
 * X-Frame-Options are set only where the handler set none, because the storage preview locks its
 * own response down harder than the dashboard's policy would and is framed by the dashboard on
 * purpose; a middleware that overwrote either would loosen the one path that renders someone
 * else's bytes, or blank it.
 */
export function securityHeaders(options: HeaderOptions): MiddlewareHandler {
  const base = secureHeaders({
    strictTransportSecurity: options.hsts ? "max-age=31536000; includeSubDomains" : false,
    // Set below, and only where the handler set none: the stored-file preview is framed by the
    // dashboard on purpose and answers SAMEORIGIN itself.
    xFrameOptions: false,
    referrerPolicy: "no-referrer",
    crossOriginOpenerPolicy: "same-origin",
    permissionsPolicy: { camera: [], microphone: [], geolocation: [], payment: [], usb: [] },
  });
  return async (c, next) => {
    await base(c, next);
    const headers = c.res.headers;
    if (!headers.has("x-frame-options")) headers.set("x-frame-options", "DENY");
    if (!headers.has("content-security-policy")) {
      const docs = c.req.path === `${options.apiPrefix}/docs`;
      headers.set("content-security-policy", docs ? DOCS_CSP : APP_CSP);
    }
    if (c.req.path.startsWith(`${options.apiPrefix}/`) && !headers.has("cache-control")) {
      headers.set("cache-control", "no-store");
    }
  };
}

export type HardeningOptions = HeaderOptions & {
  uploadBytes: number;
  /** Sets `actor`; the anonymous budget below reads it, so it is installed here, in order. */
  authenticate: MiddlewareHandler;
  anonymousPerMinute: number;
  trustProxy: boolean;
  now: () => Date;
};

export type HardeningConfig = {
  TESTATE_TRUST_PROXY: boolean;
  TESTATE_BASE_PATH: string;
  TESTATE_MAX_UPLOAD_MB: number;
};

/**
 * The options from the instance's config: HSTS and the secure cookie both follow the proxy flag,
 * the cookie's `__Host-` prefix follows the base path, and strangers get 120 requests a minute
 * per address, enough for a sign-in page and a probe, not for a scan.
 */
export function hardeningFor(
  config: HardeningConfig,
  apiPrefix: string,
  resolver: ActorResolver,
  now: () => Date
): HardeningOptions {
  return {
    hsts: config.TESTATE_TRUST_PROXY,
    apiPrefix,
    uploadBytes: config.TESTATE_MAX_UPLOAD_MB * 1024 * 1024,
    authenticate: authenticate(
      resolver,
      sessionCookieName(config.TESTATE_TRUST_PROXY, config.TESTATE_BASE_PATH)
    ),
    anonymousPerMinute: 120,
    trustProxy: config.TESTATE_TRUST_PROXY,
    now,
  };
}

/** Every request middleware 07 §7.5 names, in the order they depend on each other. */
export function installHardening(app: Hono, options: HardeningOptions): void {
  const mib = 1024 * 1024;
  app.use("*", securityHeaders(options));
  app.use(
    `${options.apiPrefix}/*`,
    // A mebibyte over the upload cap, for the multipart boundary and the fields beside the file.
    bodyLimits({ json: mib, mcp: 2 * mib, upload: options.uploadBytes + mib })
  );
  app.use("*", options.authenticate);
  app.use(`${options.apiPrefix}/*`, anonymousLimit(options));
}

export type AnonymousLimit = { anonymousPerMinute: number; trustProxy: boolean; now: () => Date };

/**
 * Requests that carry no credential share one sliding-minute budget per client address (07
 * §7.5). Login already charges failures per address; this covers everything else a stranger can
 * reach: the surface a scanner walks, a route guessed at, a token tried at random. Health stays
 * out of it, because a liveness probe has no credential and must never be told to wait.
 */
export function anonymousLimit(options: AnonymousLimit): MiddlewareHandler {
  const limiter = createRateLimiter(options.now);
  return async (c, next) => {
    const anonymous = c.get("actor") === null;
    const probe = /\/health(\/|$)/.test(c.req.path);
    if (anonymous && !probe) {
      const address = requestMeta(c, options.trustProxy).ip ?? "unknown";
      const wait = limiter.hit(address, options.anonymousPerMinute);
      if (wait !== null) throw rateLimited(wait);
    }
    await next();
  };
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

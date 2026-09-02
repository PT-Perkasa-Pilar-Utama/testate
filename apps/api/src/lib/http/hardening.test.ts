import { describe, expect, it } from "bun:test";
import { Hono } from "hono";

import { errorResponse } from "./errors.ts";
import { bodyLimits, securityHeaders } from "./hardening.ts";

const PREFIX = "/api/v1";
const MIB = 1024 * 1024;

function app(hsts = false): Hono {
  const a = new Hono();
  a.onError((cause, c) => errorResponse(c, cause, undefined, false));
  a.use("*", securityHeaders({ hsts, apiPrefix: PREFIX }));
  a.use(`${PREFIX}/*`, bodyLimits({ json: MIB, mcp: 2 * MIB, upload: 4 * MIB }));
  a.get("/", (c) => c.html("<p>app</p>"));
  a.get(`${PREFIX}/docs`, (c) => c.html("<p>docs</p>"));
  a.get(`${PREFIX}/preview`, (c) => {
    c.header("Content-Security-Policy", "sandbox; default-src 'none'");
    return c.body("bytes", 200);
  });
  a.post(`${PREFIX}/echo`, async (c) => c.json({ size: (await c.req.text()).length }));
  a.post(`${PREFIX}/mcp`, async (c) => c.json({ size: (await c.req.text()).length }));
  return a;
}

describe("security headers (07 §7.5)", () => {
  it("sends the dashboard policy, frame denial and no HSTS off a plain socket", async () => {
    const res = await app().request("/");
    const csp = String(res.headers.get("content-security-policy"));
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("jsdelivr");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("permissions-policy")).toContain("camera=()");
    expect(res.headers.get("strict-transport-security")).toBeNull();
    expect(res.headers.get("cache-control")).toBeNull();
  });

  it("sends HSTS behind a TLS proxy and never caches an API answer", async () => {
    const res = await app(true).request(`${PREFIX}/echo`, { method: "POST", body: "{}" });
    expect(res.headers.get("strict-transport-security")).toBe(
      "max-age=31536000; includeSubDomains"
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("lets the API reference load Scalar from its CDN", async () => {
    const res = await app().request(`${PREFIX}/docs`);
    expect(res.headers.get("content-security-policy")).toContain("https://cdn.jsdelivr.net");
  });

  it("keeps the preview's own, stricter policy", async () => {
    const res = await app().request(`${PREFIX}/preview`);
    expect(res.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'");
  });
});

describe("body limits (07 §7.5)", () => {
  const big = "x".repeat(MIB + 1);

  it("refuses a JSON body over a mebibyte with the 413 envelope", async () => {
    const res = await app().request(`${PREFIX}/echo`, { method: "POST", body: big });
    expect(res.status).toBe(413);
    const body = await res.text();
    expect(body).toContain('"code":"PAYLOAD_TOO_LARGE"');
    expect(body).toContain(`"limit_bytes":${MIB}`);
  });

  it("gives the agent endpoint room for a file inside its arguments", async () => {
    const res = await app().request(`${PREFIX}/mcp`, { method: "POST", body: big });
    expect(res.status).toBe(200);
  });

  it("caps a multipart upload at the upload limit, not the JSON one", async () => {
    const res = await app().request(`${PREFIX}/echo`, {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x" },
      body: big,
    });
    expect(res.status).toBe(200);
  });
});

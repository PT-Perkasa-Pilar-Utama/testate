import { describe, expect, it } from "bun:test";
import { Hono } from "hono";

import { apiReferencePage, mountApiReference } from "./openapi.ts";

describe("the API reference page", () => {
  it("points Scalar at the document it is given", async () => {
    const app = new Hono();
    mountApiReference(app, "/qa/api/v1/openapi.json");
    const html = await (await app.request("/docs")).text();
    expect(html).toContain('createApiReference("#app", {"url":"/qa/api/v1/openapi.json"})');
  });

  it("cannot be closed early by a base path that carries a script tag", () => {
    const html = apiReferencePage("/</script><script>alert(1)</script>/openapi.json");
    expect(html.match(/<\/script>/g)).toHaveLength(1);
  });
});

import type { Hono, MiddlewareHandler } from "hono";
import { describeRoute, openAPIRouteHandler, resolver } from "hono-openapi";
import type { GenericSchema } from "valibot";

type DescribeConfig = Parameters<typeof describeRoute>[0];
type Responses = NonNullable<DescribeConfig["responses"]>;

function responsesFor(
  status: 200 | 201 | 202 | 204,
  summary: string,
  schema: GenericSchema
): Responses {
  const body = {
    description: summary,
    content: { "application/json": { schema: resolver(schema) } },
  };
  switch (status) {
    case 200:
      return { 200: body };
    case 201:
      return { 201: body };
    case 202:
      return { 202: body };
    case 204:
      return { 204: { description: "No content" } };
  }
}

/** One call per route: summary, tag, and the success schema for the OpenAPI document. */
export function describe(
  tag: string,
  summary: string,
  schema: GenericSchema,
  status: 200 | 201 | 202 | 204 = 200
): MiddlewareHandler {
  return describeRoute({ tags: [tag], summary, responses: responsesFor(status, summary, schema) });
}

/** Mounts `/openapi.json` on the given app. The document is generated from the routes' describe() calls. */
export function mountOpenApi(app: Hono, version: string): void {
  app.get(
    "/openapi.json",
    openAPIRouteHandler(app, {
      documentation: {
        info: {
          title: "Testate API",
          version,
          description: "Git for your test database. See docs/api-specs for the contract.",
        },
        components: {
          securitySchemes: {
            bearer: { type: "http", scheme: "bearer", description: "API token tst_..." },
            session: { type: "apiKey", in: "cookie", name: "testate_session" },
          },
        },
      },
    })
  );
}

// Scalar's own Hono package renders this same page, but it drags in zod for its config types.
const REFERENCE_BUNDLE = "https://cdn.jsdelivr.net/npm/@scalar/api-reference/esm.js";

/** The API reference page: Scalar's bundle from jsdelivr, pointed at the document. */
export function apiReferencePage(documentUrl: string): string {
  // A base path comes from the env; `<` escaped so it can never close the inline script.
  const config = JSON.stringify({ url: documentUrl }).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html>
  <head>
    <title>Testate API</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module">
      import { createApiReference } from "${REFERENCE_BUNDLE}";
      createApiReference("#app", ${config});
    </script>
  </body>
</html>`;
}

/** Mounts `/docs`, the reference for the document `mountOpenApi` serves at `documentUrl`. */
export function mountApiReference(app: Hono, documentUrl: string): void {
  const page = apiReferencePage(documentUrl);
  app.get("/docs", (c) => c.html(page));
}

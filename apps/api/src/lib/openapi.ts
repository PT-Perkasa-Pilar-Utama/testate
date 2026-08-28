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

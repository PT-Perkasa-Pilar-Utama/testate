/**
 * The version the API reports: `/health`, the boot event, the OpenAPI document, the MCP server
 * info, and a backup manifest. It matches the root `package.json`, which the release workflow
 * tags the image with. `bun run bump-version` writes both, and `version.test.ts` fails if they
 * ever drift apart.
 */
export const VERSION = "1.0.1-alpha";

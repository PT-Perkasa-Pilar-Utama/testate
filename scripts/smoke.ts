// Browser smoke test. Sprint 0: checks that the API answers /health and /health/ready.
// Playwright flows (login, adapter, snapshot, checkout, diff, import) land with their cards.
const base = Bun.env["SMOKE_BASE_URL"] ?? "http://localhost:3000";

async function check(path: string, expected: number): Promise<void> {
  const response = await fetch(`${base}${path}`);
  if (response.status !== expected) {
    throw new Error(`${path}: expected ${expected}, got ${response.status}`);
  }
  console.log(`ok ${path} ${response.status}`);
}

await check("/api/v1/health/live", 204);
await check("/api/v1/health/ready", 204);
await check("/api/v1/health", 200);

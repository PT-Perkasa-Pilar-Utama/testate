/**
 * Seeds a running instance with the demo the browser suite runs against, plus what the suite
 * itself leaves behind, so every screen has something on it: a project on the compose engines,
 * three states with tags, a checkout, a diff against the live databases, a saved query, two more
 * accounts and two tokens. Point it at your own `bun run dev` (TESTATE_ENV=development):
 *
 *   TESTATE_ADMIN_PASSWORD=<your bootstrap password> bun run seed:dev [http://localhost:7378]
 *
 * It resets the instance: `POST /admin/reset-state` drops every project, adapter, state and
 * account and recreates the dev seed. Run it against a box you do not mind wiping, with
 * `docker compose -f deploy/compose.engines.yml up -d` running beside it. Passwords come out the
 * same as the suite's, and the agent token is printed once at the end.
 */
import * as v from "valibot";

const base = (process.argv[2] ?? "http://localhost:7378").replace(/\/$/, "");
const bootstrap = Bun.env["TESTATE_ADMIN_PASSWORD"] ?? "";
if (bootstrap === "")
  throw new Error("set TESTATE_ADMIN_PASSWORD to the instance's bootstrap password");

const FINAL = {
  admin: "admin-final-password-1",
  qa: "qa-final-password-1",
  viewer: "viewer-final-password-1",
};
const TEMP = { qa: "qa-password-1234", viewer: "viewer-password-1234" };

const say = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

type Session = { cookie: string };
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
/** A request body: the JSON the API parses on its side. */
type Payload = { [key: string]: Json };

async function call(
  session: Session | null,
  method: string,
  path: string,
  body?: Payload
): Promise<Response> {
  const headers = new Headers({ "X-Testate-Request": "1", Accept: "application/json" });
  if (session !== null) headers.set("Cookie", session.cookie);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  return fetch(`${base}/api/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function expectOk(response: Response, what: string): Promise<Response> {
  if (response.ok) return response;
  throw new Error(`${what}: ${response.status} ${await response.text()}`);
}

async function login(username: string, password: string): Promise<Session | null> {
  const response = await call(null, "POST", "auth/login", { username, password });
  if (!response.ok) return null;
  const cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
  if (cookie === "") throw new Error(`${username}: no session cookie in the login reply`);
  return { cookie };
}

/** The final password, whether the account still has its temporary one or was rotated already. */
async function rotate(username: string, from: string, to: string): Promise<Session> {
  const already = await login(username, to);
  if (already !== null) return already;
  const session = await login(username, from);
  if (session === null) throw new Error(`${username}: neither password signs in`);
  await expectOk(
    await call(session, "POST", "auth/password", { current: from, next: to }),
    `${username}: password change`
  );
  const fresh = await login(username, to);
  if (fresh === null) throw new Error(`${username}: the new password does not sign in`);
  return fresh;
}

const jobSchema = v.object({ id: v.string(), status: v.string() });

async function waitForJob(session: Session, id: string): Promise<string> {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const body = v.parse(
      v.object({ data: jobSchema }),
      await (await call(session, "GET", `jobs/${id}`)).json()
    );
    if (!["queued", "running"].includes(body.data.status)) return body.data.status;
    await Bun.sleep(500);
  }
  throw new Error(`job ${id} never finished`);
}

const startedSchema = v.object({ data: v.object({ job: jobSchema }) });

async function takeState(session: Session, name: string, tags: string[]): Promise<void> {
  const response = await expectOk(
    await call(session, "POST", "projects/demo/states", { name, tags }),
    `take ${name}`
  );
  const status = await waitForJob(
    session,
    v.parse(startedSchema, await response.json()).data.job.id
  );
  say(`state ${name}: ${status}`);
}

const listSchema = v.object({
  data: v.array(v.object({ id: v.string(), name: v.string(), engine: v.optional(v.string()) })),
});

async function ids(
  session: Session,
  path: string
): Promise<{ id: string; name: string; engine?: string }[]> {
  return v.parse(listSchema, await (await call(session, "GET", path)).json()).data;
}

// 1. The bootstrap admin, the loopback deny list lifted (the engines live on 127.0.0.1), the seed.
let admin = await rotate("admin", bootstrap, FINAL.admin);
await expectOk(await call(admin, "PATCH", "settings", { netguard: { deny: [] } }), "settings");
const reset = await expectOk(
  await call(admin, "POST", "admin/reset-state", { seed: "dev", confirm: "reset" }),
  "reset-state (is TESTATE_ENV=development?)"
);
const report = v.parse(
  v.object({ data: v.object({ adapters: v.number(), warnings: v.array(v.string()) }) }),
  await reset.json()
);
if (report.data.warnings.length > 0)
  throw new Error(`seed warnings: ${report.data.warnings.join("; ")}`);
say(`seeded the demo project with ${report.data.adapters} adapters`);

// 2. The reset recreated every account with a temporary password; rotate them all again.
admin = await rotate("admin", bootstrap, FINAL.admin);
await expectOk(await call(admin, "PATCH", "settings", { netguard: { deny: [] } }), "settings");
const qa = await rotate("qa-user", TEMP.qa, FINAL.qa);
await rotate("viewer-user", TEMP.viewer, FINAL.viewer);

// 3. What the suite leaves behind: named states, a checkout, a diff, a saved query.
await takeState(qa, "checkout-flow-baseline", ["release-2.4"]);
await takeState(qa, "after-the-failed-refund", ["bug-4182"]);
const states = await ids(qa, "projects/demo/states");
const baseline = states.find((state) => state.name === "seeded-baseline");
if (baseline === undefined) throw new Error("the seed left no seeded-baseline state");
const checkout = await expectOk(
  await call(qa, "POST", "projects/demo/checkouts", { state_id: baseline.id }),
  "checkout"
);
say(
  `checkout of seeded-baseline: ${await waitForJob(qa, v.parse(startedSchema, await checkout.json()).data.job.id)}`
);
const diff = await expectOk(
  await call(qa, "POST", "projects/demo/diffs", { base_state_id: baseline.id, target: "live" }),
  "diff"
);
say(
  `diff seeded-baseline vs live: ${await waitForJob(qa, v.parse(startedSchema, await diff.json()).data.job.id)}`
);
const adapters = await ids(qa, "projects/demo/adapters");
const postgres = adapters.find((adapter) => adapter.engine === "postgres");
if (postgres !== undefined) {
  await expectOk(
    await call(qa, "POST", `projects/demo/adapters/${postgres.id}/saved-queries`, {
      name: "rows after a reset",
      body: { sql: "SELECT * FROM contract.customers ORDER BY 1 LIMIT 5" },
    }),
    "saved query"
  );
  say("saved query: rows after a reset");
}

// 4. Tokens: one for a pipeline, one for an agent, both scoped to the demo project.
const projects = await ids(admin, "projects?limit=50");
const demo = projects.find((project) => project.name === "Demo");
const tokenSchema = v.object({ data: v.object({ token: v.string() }) });
const personal = await expectOk(
  await call(admin, "POST", "tokens", {
    name: "ci pipeline",
    role: "qa",
    project_ids: demo === undefined ? null : [demo.id],
  }),
  "personal token"
);
const agent = await expectOk(
  await call(admin, "POST", "tokens", {
    name: "claude",
    kind: "agent",
    role: "viewer",
    project_ids: demo === undefined ? null : [demo.id],
  }),
  "agent token"
);
const ci = v.parse(tokenSchema, await personal.json()).data.token;
const mcp = v.parse(tokenSchema, await agent.json()).data.token;

say(`
Seeded ${base}. Sign in as:
  admin        ${FINAL.admin}      (Administrator)
  qa-user      ${FINAL.qa}         (Tester)
  viewer-user  ${FINAL.viewer}     (Guest)

Tokens, shown once:
  ci pipeline (REST, qa):   ${ci}
  claude (MCP, guest):      ${mcp}

  claude mcp add --transport http testate ${base}/api/v1/mcp --header "Authorization: Bearer ${mcp}"
`);

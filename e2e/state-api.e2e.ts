import { expect, test } from "@playwright/test";

import {
  apiContext,
  bearerContext,
  blobCount,
  createToken,
  demoAdapter,
  demoProjectId,
  refusedOf,
  stateHashes,
  takeState,
  waitForIdle,
  waitForJob,
} from "./lib/api.ts";
import { callTool } from "./lib/mcp.ts";

const STAMP = Date.now().toString(36);

// Every test here holds the Postgres adapter; the project runs after `states` and before `adapter`.
test.describe.configure({ mode: "serial" });

/** Story stories the screens do not show: one HTTP call per story, against the same demo project. */
test.describe("state and job contract stories", () => {
  test("@story-114 takes a state over the API after a run and sees it in the list", async () => {
    test.setTimeout(180_000);
    const qa = await apiContext("qa");
    const postgres = await demoAdapter({ engine: "postgres" });
    const taken = await takeState(qa, `api-take-${STAMP}`, postgres.id);
    expect(taken.job.status).toBe("succeeded");
    expect(taken.job.kind).toBe("snapshot");
    const states: { data: { name: string; status: string }[] } = await (
      await qa.get("projects/demo/states?limit=200")
    ).json();
    const mine = states.data.filter((state) => state.name === `api-take-${STAMP}`);
    expect(mine.map((state) => state.status)).toStrictEqual(["ready"]);
    await qa.dispose();
  });

  test("@story-115 a repeated Idempotency-Key returns the first job, not a second one", async () => {
    test.setTimeout(180_000);
    const qa = await apiContext("qa");
    const postgres = await demoAdapter({ engine: "postgres" });
    const headers = { "Idempotency-Key": `idem-${STAMP}` };
    const name = `api-idem-${STAMP}`;
    const first = await takeState(qa, name, postgres.id, headers);
    // The retry a CI pipeline makes after a timeout: the same job, the same state, no second run.
    const again = await takeState(qa, name, postgres.id, headers);
    expect(again.job.id).toBe(first.job.id);
    expect(again.stateId).toBe(first.stateId);
    const states: { data: { name: string }[] } = await (
      await qa.get("projects/demo/states?limit=200")
    ).json();
    expect(states.data.filter((state) => state.name === name).length).toBe(1);

    const different = await qa.post("projects/demo/states", {
      data: { name: `${name}-other`, adapter_ids: [postgres.id] },
      headers,
    });
    expect(different.status()).toBe(409);
    const failure: { error: { code: string } } = await different.json();
    expect(failure.error.code).toBe("CONFLICT");
    await qa.dispose();
  });

  test("@story-74 a finished snapshot job reports the table it was writing", async () => {
    test.setTimeout(180_000);
    const qa = await apiContext("qa");
    const postgres = await demoAdapter({ engine: "postgres" });
    const taken = await takeState(qa, `api-progress-${STAMP}`, postgres.id);
    const detail: { data: { progress: { phase: string; table: string; tables_done: number } } } =
      await (await qa.get(`jobs/${taken.job.id}`)).json();
    expect(detail.data.progress.phase).toBe("snapshot");
    expect(detail.data.progress.tables_done).toBeGreaterThan(0);
    expect(detail.data.progress.table.length).toBeGreaterThan(0);
    await qa.dispose();
  });

  test("@story-70 an unchanged table is stored once across two states", async () => {
    test.setTimeout(180_000);
    const qa = await apiContext("qa");
    const postgres = await demoAdapter({ engine: "postgres" });
    const one = await stateHashes(qa, `api-dedupe-a-${STAMP}`, postgres.id);
    expect(one.length).toBeGreaterThan(0);
    const blobsAfterFirst = blobCount();
    const two = await stateHashes(qa, `api-dedupe-b-${STAMP}`, postgres.id);
    // Same content, same hashes: the second state points at the first state's blobs.
    expect(two).toStrictEqual(one);
    expect(blobCount()).toBe(blobsAfterFirst);
    await qa.dispose();
  });

  test("@story-86 a second job on a busy adapter is refused", async () => {
    test.setTimeout(180_000);
    const qa = await apiContext("qa");
    const postgres = await demoAdapter({ engine: "postgres" });
    const [one, two] = await Promise.all([
      qa.post("projects/demo/states", {
        data: { name: `api-busy-a-${STAMP}`, adapter_ids: [postgres.id] },
      }),
      qa.post("projects/demo/states", {
        data: { name: `api-busy-b-${STAMP}`, adapter_ids: [postgres.id] },
      }),
    ]);
    expect([one.status(), two.status()].sort()).toStrictEqual([202, 409]);
    const refused: { error: { code: string; details: { adapter_id: string } } } = await refusedOf(
      one,
      two
    ).json();
    expect(refused.error.code).toBe("JOB_IN_PROGRESS");
    expect(refused.error.details.adapter_id).toBe(postgres.id);
    await waitForIdle(qa, postgres.id);
    await qa.dispose();
  });

  test("@story-128 a backup records the key fingerprints that sealed its values", async () => {
    test.setTimeout(180_000);
    const admin = await apiContext("admin");
    const response = await admin.post("settings/backup", {
      data: { include_blobs: false, destination: "download" },
    });
    expect(response.status()).toBe(202);
    const started: { data: { id: string } } = await response.json();
    const job = await waitForJob(admin, started.data.id);
    expect(job.status).toBe("succeeded");
    const detail: { data: { result: { key_fingerprints: string[]; size_bytes: number } } } = await (
      await admin.get(`jobs/${started.data.id}`)
    ).json();
    expect(detail.data.result.key_fingerprints.length).toBeGreaterThan(0);
    expect(detail.data.result.size_bytes).toBeGreaterThan(0);
    await admin.dispose();
  });

  test("@story-113 checks out a state by name and waits for the job in the same call", async () => {
    test.setTimeout(180_000);
    const qa = await apiContext("qa");
    const response = await qa.post("projects/demo/checkouts?wait=120", {
      data: { state_name: `api-take-${STAMP}` },
    });
    expect(response.status()).toBe(200);
    const body: {
      data: {
        job: { status: string; kind: string };
        checkout: { status: string; state: { name: string } };
      };
    } = await response.json();
    expect(body.data.job.kind).toBe("checkout");
    expect(body.data.job.status).toBe("succeeded");
    expect(body.data.checkout.status).toBe("succeeded");
    expect(body.data.checkout.state.name).toBe(`api-take-${STAMP}`);
    await qa.dispose();
  });

  // Here and not in agent.e2e.ts: that spec runs in the first phase beside the UI write session
  // on the same adapter, and two write sessions race story 86's one job per adapter.
  test("@story-153 a tester agent writes through a stashed session; a viewer agent is refused", async () => {
    test.setTimeout(180_000);
    const admin = await apiContext("admin");
    const postgres = await demoAdapter({ engine: "postgres" });
    await waitForIdle(admin, postgres.id);
    const scope = { kind: "agent" as const, project_ids: [await demoProjectId(admin)] };
    const tester = await createToken(admin, {
      ...scope,
      name: `agent-tester-${STAMP}`,
      role: "qa",
    });
    const viewer = await createToken(admin, { ...scope, name: `agent-viewer-${STAMP}` });
    const target = { project: "demo", adapter: postgres.id };
    const sql = `insert into contract.customers (email) values ('agent-${STAMP}@e2e.test')`;

    const reader = await bearerContext(viewer.token);
    await expect(callTool(reader, "run_write_query", { ...target, sql })).rejects.toThrow(/role/);
    await reader.dispose();

    const writer = await bearerContext(tester.token);
    const written: { write_session_id: string } = await callTool(writer, "run_write_query", {
      ...target,
      sql,
    });
    expect(written.write_session_id).not.toBe("");
    const ended: { ended: string | null; stash_state_id: string | null } = await callTool(
      writer,
      "end_write_session",
      target
    );
    expect(ended.ended).toBe(written.write_session_id);
    expect(ended.stash_state_id).not.toBeNull();
    await writer.dispose();

    await admin.delete(`tokens/${tester.record.id}`);
    await admin.delete(`tokens/${viewer.record.id}`);
    await admin.dispose();
  });
});

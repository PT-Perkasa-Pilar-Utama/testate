import { expect, test } from "@playwright/test";

import {
  apiContext,
  createPostgresAdapter,
  demoAdapter,
  blobCount,
  refusedOf,
  stateHashes,
  takeState,
  waitForIdle,
  waitForJob,
} from "./lib/api.ts";

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

  test("@story-115 a repeated Idempotency-Key replays the first job instead of a second", async () => {
    test.setTimeout(180_000);
    const qa = await apiContext("qa");
    const adapter = await createPostgresAdapter(qa, `idem-${STAMP}`);
    await waitForIdle(qa, adapter.id);
    const plan: { data: { plan_id: string } } = await (
      await qa.get(`projects/demo/adapters/${adapter.id}/deletion-plan`)
    ).json();
    // `skip` leaves the shared database alone; only the adapter row goes.
    const body = {
      data: { plan_id: plan.data.plan_id, action: "skip" },
      headers: { "Idempotency-Key": `idem-${STAMP}` },
    };
    const first = await qa.post(`projects/demo/adapters/${adapter.id}/deletion`, body);
    expect(first.status()).toBe(202);
    const job: { data: { id: string } } = await first.json();

    const repeat = await qa.post(`projects/demo/adapters/${adapter.id}/deletion`, body);
    const same: { data: { id: string } } = await repeat.json();
    expect(same.data.id).toBe(job.data.id);
    const jobs: { data: { id: string; kind: string }[] } = await (
      await qa.get("jobs?kind=adapter_delete&limit=100")
    ).json();
    expect(jobs.data.filter((row) => row.id === job.data.id).length).toBe(1);
    await waitForJob(qa, job.data.id);
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
});

import { describe, expect, it } from "bun:test";
import type { Actor, Job } from "@testate/shared";
import * as v from "valibot";

import { createAccounts } from "../../../test/accounts.ts";
import { createJobsHarness } from "../../../test/jobs.ts";
import type { JobsHarness } from "../../../test/jobs.ts";
import { QA_ACTOR } from "../../lib/mock/fixtures.ts";
import type { JobRunner } from "./jobs.dispatcher.ts";
import type { JobEvent } from "./jobs.events.ts";
import type { EnqueueInput } from "./jobs.service.ts";

const PROJECT = "01991f00-0000-7000-8000-000000000010";
const OTHER = "01991f00-0000-7000-8000-000000000011";

type Harness = JobsHarness & {
  admin: Actor;
  advance: (ms: number) => void;
  db: Awaited<ReturnType<typeof createAccounts>>["db"];
};

async function setup(cap = 2): Promise<Harness> {
  const accounts = await createAccounts();
  const runtime = createJobsHarness(accounts.db, accounts.now, cap);
  for (const [id, slug] of [
    [PROJECT, "shop"],
    [OTHER, "billing"],
  ] as const) {
    accounts.projectsRepo.insert({
      id,
      slug,
      name: slug,
      description: null,
      quota_bytes: null,
      created_by: accounts.admin.id,
      created_at: accounts.now().toISOString(),
    });
  }
  return { ...runtime, admin: accounts.admin, advance: accounts.advance, db: accounts.db };
}

function input(overrides: Partial<EnqueueInput> = {}): EnqueueInput {
  return {
    kind: "snapshot",
    projectId: PROJECT,
    adapterIds: ["a1"],
    payload: { n: 1 },
    actor: { ...QA_ACTOR },
    parentRequestId: null,
    ...overrides,
  };
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 60));

/** A runner that checks the signal between 5 ms batches, like an engine loop would. */
const batchedRunner: JobRunner = async ({ signal, progress }) => {
  for (let batch = 0; batch < 200; batch += 1) {
    if (signal.aborted) throw new Error("stopped");
    progress({ batch });
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return { status: "succeeded", result: {} };
};

async function untilTerminal(h: JobsHarness, id: string): Promise<Job> {
  return h.jobs.wait(null, id, 5);
}

describe("jobs runtime", () => {
  it("runs a queued job, stores progress and result, and publishes events", async () => {
    const h = await setup();
    const frames: JobEvent[] = [];
    h.dispatcher.registerKind("snapshot", async ({ progress }) => {
      progress({ phase: "read", rows: 10 });
      await settle();
      return { status: "succeeded", result: { rows: 10 } };
    });
    const queued = await h.jobs.enqueue(input());
    expect(queued.status).toBe("queued");
    expect(queued.queue_position).toBe(1);
    h.hub.subscribe(queued.id, (event) => frames.push(event));
    h.dispatcher.start();
    const done = await untilTerminal(h, queued.id);
    expect(done.status).toBe("succeeded");
    expect(done.result).toStrictEqual({ rows: 10 });
    expect(done.progress).toStrictEqual({ phase: "read", rows: 10 });
    expect(done.started_at).not.toBeNull();
    expect(frames.map((f) => f.event)).toStrictEqual(["status", "progress", "status"]);
    await h.dispatcher.drain(100);
  });

  it("fails a job whose runner throws, keeping the error code", async () => {
    const h = await setup();
    h.dispatcher.registerKind("snapshot", async () => {
      throw new Error("boom");
    });
    const job = await h.jobs.enqueue(input());
    h.dispatcher.start();
    const done = await untilTerminal(h, job.id);
    expect(done.status).toBe("failed");
    expect(done.error).toStrictEqual({ code: "INTERNAL", message: "boom" });
    await h.dispatcher.drain(100);
  });

  it("refuses a job on an adapter another queued or running job claims", async () => {
    const h = await setup();
    await h.jobs.enqueue(input({ adapterIds: ["a1", "a2"] }));
    await expect(
      h.jobs.enqueue(input({ kind: "checkout", adapterIds: ["a2"] }))
    ).rejects.toMatchObject({ code: "JOB_IN_PROGRESS", details: { adapter_id: "a2" } });
    await expect(h.jobs.enqueue(input({ adapterIds: ["a3"] }))).resolves.toBeDefined();
  });

  it("queues beyond the cap with positions and starts the next when a slot frees", async () => {
    const h = await setup(1);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.dispatcher.registerKind("snapshot", async () => {
      await gate;
      return { status: "succeeded", result: {} };
    });
    const first = await h.jobs.enqueue(input({ adapterIds: ["a1"] }));
    const second = await h.jobs.enqueue(input({ adapterIds: ["a2"] }));
    const third = await h.jobs.enqueue(input({ adapterIds: ["a3"] }));
    h.dispatcher.start();
    await settle();
    expect((await h.jobs.get(null, first.id)).status).toBe("running");
    expect((await h.jobs.get(null, second.id)).queue_position).toBe(1);
    expect((await h.jobs.get(null, third.id)).queue_position).toBe(2);
    expect(h.jobs.heartbeat()).toMatchObject({ alive: true, running: 1, queued: 2 });
    release();
    await untilTerminal(h, third.id);
    expect((await h.jobs.get(null, second.id)).status).toBe("succeeded");
    await h.dispatcher.drain(100);
  });

  it("cancels a running job between batches and a queued job at once", async () => {
    const h = await setup(1);
    h.dispatcher.registerKind("snapshot", batchedRunner);
    const running = await h.jobs.enqueue(input({ adapterIds: ["a1"] }));
    const waiting = await h.jobs.enqueue(
      input({ adapterIds: ["a2"], actor: { ...QA_ACTOR, id: h.admin.id } })
    );
    h.dispatcher.start();
    await settle();
    await expect(
      h.jobs.cancel({ ...QA_ACTOR, id: h.admin.id, role: "qa" }, null, running.id)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const asked = await h.jobs.cancel({ ...QA_ACTOR }, null, running.id);
    expect(asked.cancel_requested).toBe(true);
    expect((await untilTerminal(h, running.id)).status).toBe("cancelled");
    await h.dispatcher.drain(100);
    const stopped = await h.jobs.cancel(h.admin, null, waiting.id);
    expect(stopped.status).toBe("cancelled");
    await expect(h.jobs.cancel(h.admin, null, waiting.id)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("waits until terminal or the timeout", async () => {
    const h = await setup();
    h.dispatcher.registerKind("snapshot", async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return { status: "partial", result: { skipped: 1 } };
    });
    const job = await h.jobs.enqueue(input());
    h.dispatcher.start();
    const early = await h.jobs.wait(null, job.id, 0.05);
    expect(early.status).not.toBe("partial");
    const late = await h.jobs.wait(null, job.id, 5);
    expect(late.status).toBe("partial");
    await h.dispatcher.drain(100);
  });

  it("returns the same job for a repeated Idempotency-Key and refuses a different body", async () => {
    const h = await setup();
    const first = await h.jobs.enqueue(input({ idempotencyKey: "k1" }));
    const again = await h.jobs.enqueue(input({ idempotencyKey: "k1" }));
    expect(again.id).toBe(first.id);
    await expect(
      h.jobs.enqueue(input({ idempotencyKey: "k1", payload: { n: 2 } }))
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const other = await h.jobs.enqueue(
      input({ idempotencyKey: "k1", actor: { ...QA_ACTOR, id: h.admin.id }, adapterIds: ["b1"] })
    );
    expect(other.id).not.toBe(first.id);
  });

  it("filters get and list by project scope and hides instance jobs from non-admins", async () => {
    const h = await setup();
    const shop = await h.jobs.enqueue(input({ adapterIds: ["a1"] }));
    await h.jobs.enqueue(input({ projectId: OTHER, adapterIds: ["b1"] }));
    await h.jobs.enqueue(input({ kind: "backup", projectId: null, adapterIds: [] }));
    await expect(h.jobs.get([OTHER], shop.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(h.jobs.get([PROJECT], shop.id)).resolves.toBeDefined();
    const qa = { ...QA_ACTOR };
    expect((await h.jobs.list(qa, null, { limit: 10, order: "desc" })).rows.length).toBe(2);
    expect((await h.jobs.list(h.admin, null, { limit: 10, order: "desc" })).rows.length).toBe(3);
    expect(
      (await h.jobs.list(h.admin, [OTHER], { limit: 10, order: "desc" })).rows.map(
        (j) => j.project_id
      )
    ).toStrictEqual([null, OTHER]);
    expect(
      (await h.jobs.list(qa, null, { limit: 10, order: "desc", adapter_id: "b1" })).rows.length
    ).toBe(1);
    const page = await h.jobs.list(h.admin, null, { limit: 2, order: "desc" });
    expect(page.nextCursor).not.toBeNull();
    const cursor = v.parse(v.string(), page.nextCursor);
    expect(
      (await h.jobs.list(h.admin, null, { limit: 2, order: "desc", cursor })).rows.length
    ).toBe(1);
  });

  it("recovers running jobs at boot: interrupted, HEAD unknown, states failed", async () => {
    const h = await setup();
    const checkout = await h.jobs.enqueue(input({ kind: "checkout", adapterIds: ["a1"] }));
    const snapshot = await h.jobs.enqueue(
      input({ kind: "snapshot", adapterIds: ["a2"], payload: { state_id: "s1" } })
    );
    h.db
      .query(
        "INSERT INTO states (id, project_id, name, kind, status, tags, job_id, created_at, updated_at) VALUES ('s1', ?, 'init', 'init', 'creating', '[]', ?, 'x', 'x')"
      )
      .run(PROJECT, snapshot.id);
    h.repo.markRunning(checkout.id, "x");
    h.repo.markRunning(snapshot.id, "x");
    const report = await h.jobs.recover();
    expect(report).toStrictEqual({ interrupted: 2, head_unknown: 1, states_failed: 1 });
    expect((await h.jobs.get(null, checkout.id)).status).toBe("interrupted");
    expect(h.db.query("SELECT head_status FROM projects WHERE id = ?").get(PROJECT)).toStrictEqual({
      head_status: "unknown",
    });
    expect(h.db.query("SELECT status FROM states WHERE id = 's1'").get()).toStrictEqual({
      status: "failed",
    });
  });

  it("sweeps old terminal jobs and keeps a stub for referenced ones", async () => {
    const h = await setup();
    const gone = await h.jobs.enqueue(input({ adapterIds: ["a1"] }));
    const kept = await h.jobs.enqueue(input({ adapterIds: ["a2"] }));
    h.repo.finish(gone.id, "succeeded", {}, null, "2026-01-01T00:00:00.000Z");
    h.repo.finish(kept.id, "succeeded", {}, null, "2026-01-01T00:00:00.000Z");
    h.db
      .query(
        "INSERT INTO states (id, project_id, name, kind, status, tags, job_id, created_at, updated_at) VALUES ('s2', ?, 'init', 'init', 'ready', '[]', ?, 'x', 'x')"
      )
      .run(PROJECT, kept.id);
    expect(h.jobs.sweep(90)).toStrictEqual({ deleted: 1, stubbed: 1 });
    await expect(h.jobs.get(null, gone.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(h.repo.byId(kept.id)?.payload).toStrictEqual({});
  });

  it("streams status and progress frames and closes after a terminal status", async () => {
    const h = await setup();
    h.dispatcher.registerKind("snapshot", async ({ progress }) => {
      progress({ phase: "a" });
      await settle();
      return { status: "succeeded", result: {} };
    });
    const job = await h.jobs.enqueue(input());
    const frames: string[] = [];
    const controller = new AbortController();
    const reading = (async (): Promise<void> => {
      for await (const item of h.jobs.events(null, job.id, null, controller.signal))
        frames.push(item.event);
    })();
    h.dispatcher.start();
    await reading;
    expect(frames[0]).toBe("status");
    expect(frames.at(-1)).toBe("status");
    expect(frames).toContain("progress");
    await h.dispatcher.drain(100);
  });
});

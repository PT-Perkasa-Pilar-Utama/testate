import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Hook } from "@testate/shared";

import { TEST_META } from "../../../test/accounts.ts";
import { PG, createAdaptersHarness, createSettled, httpDraft } from "../../../test/adapters.ts";
import type { AdaptersHarness } from "../../../test/adapters.ts";
import { createCheckoutsService } from "../checkouts/checkouts.service.ts";
import type { RestRequestInput } from "../rest/rest.service.ts";

const calls: string[] = [];
let server: ReturnType<typeof Bun.serve>;
let baseUrl = "";

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      calls.push(url.pathname);
      return url.pathname.startsWith("/fail")
        ? new Response("nope", { status: 500 })
        : Response.json({ ok: true });
    },
  });
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop(true);
});

type Harness = {
  harness: AdaptersHarness;
  adapterId: string;
  request: (name: string, path: string) => Promise<string>;
};

async function createHarness(): Promise<Harness> {
  const harness = await createAdaptersHarness();
  const { adapter } = await harness.adapters.create(
    harness.qa,
    "shop",
    httpDraft(baseUrl),
    TEST_META
  );
  const request = async (name: string, path: string): Promise<string> => {
    const input: RestRequestInput = {
      name,
      method: "POST",
      path,
      query: {},
      headers: {},
      secrets: {},
      body: null,
      expected_status: 200,
    };
    return (await harness.rest.create("shop", adapter.id, input)).id;
  };
  return { harness, adapterId: adapter.id, request };
}

async function bind(
  h: Harness,
  trigger: Hook["trigger"],
  requestId: string,
  failPolicy: Hook["fail_policy"] = "continue"
): Promise<Hook> {
  return h.harness.hooks.create(
    h.harness.qa,
    "shop",
    { trigger, rest_request_id: requestId, fail_policy: failPolicy, enabled: true },
    TEST_META
  );
}

function projectIdOf(harness: AdaptersHarness): string {
  const project = harness.projectsRepo.bySlug("shop");
  if (project === null) throw new Error("no shop project");
  return project.id;
}

describe("hooks", () => {
  it("binds requests in order, filters by trigger, reorders, and refuses foreign requests", async () => {
    const h = await createHarness();
    const first = await bind(h, "after_checkout", await h.request("a", "/a"));
    const second = await bind(h, "after_checkout", await h.request("b", "/b"));
    await bind(h, "after_snapshot", await h.request("c", "/c"));
    expect(
      (await h.harness.hooks.list("shop", "after_checkout")).map((hook) => hook.position)
    ).toEqual([1, 2]);
    expect((await h.harness.hooks.list("shop", undefined)).length).toBe(3);
    await expect(h.harness.hooks.reorder("shop", "after_checkout", [first.id])).rejects.toThrow(
      "hook_ids must list every hook of the trigger exactly once"
    );
    const reordered = await h.harness.hooks.reorder("shop", "after_checkout", [
      second.id,
      first.id,
    ]);
    expect(reordered.map((hook) => hook.request.name)).toEqual(["b", "a"]);
    await expect(
      bind(h, "after_import", "01991f00-0000-7000-8000-000000000999")
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(h.harness.rest.remove("shop", h.adapterId, first.request.id)).rejects.toThrow(
      "a hook references this request"
    );
  });

  it("runs the trigger's enabled hooks in order and stops on an abort failure", async () => {
    const h = await createHarness();
    await bind(h, "after_checkout", await h.request("one", "/one"));
    const failing = await bind(h, "after_checkout", await h.request("two", "/fail-two"), "abort");
    await bind(h, "after_checkout", await h.request("three", "/three"));
    await h.harness.hooks.update(h.harness.qa, "shop", failing.id, { enabled: false }, TEST_META);
    calls.length = 0;
    const ctx = {
      projectId: projectIdOf(h.harness),
      jobId: "j1",
      actor: h.harness.qa,
    };
    const results = await h.harness.hooks.run("after_checkout", ctx);
    expect(calls).toEqual(["/one", "/three"]);
    expect(results.map((result) => result.status)).toEqual(["succeeded", "succeeded"]);
    await h.harness.hooks.update(h.harness.qa, "shop", failing.id, { enabled: true }, TEST_META);
    calls.length = 0;
    await expect(h.harness.hooks.run("after_checkout", ctx)).rejects.toThrow(
      "failed with policy abort"
    );
    expect(calls).toEqual(["/one", "/fail-two"]);
  });

  it("a failing before_checkout abort hook fails the job before any restore", async () => {
    const h = await createHarness();
    const adapter = await createSettled(h.harness, PG);
    await bind(h, "before_checkout", await h.request("guard", "/fail-guard"), "abort");
    await bind(h, "after_checkout", await h.request("after", "/after"));
    h.harness.databases.get("shop")?.set("public.customers", [{ id: 9, email: "z@x.io" }]);
    const checkouts = createCheckoutsService({
      engines: h.harness.engines,
      blobs: h.harness.blobs,
      ring: h.harness.ring,
      adapters: h.harness.repo,
      states: h.harness.states,
      repo: h.harness.checkouts,
      projects: h.harness.projectsRepo,
      jobs: h.harness.runtime.jobs,
      audit: h.harness.audit,
      now: h.harness.now,
    });
    calls.length = 0;
    const started = await checkouts.create(
      h.harness.qa,
      "shop",
      { state_name: "init", force: false },
      TEST_META
    );
    const job = await h.harness.runtime.jobs.wait(null, started.job.id, 5);
    expect(job.status).toBe("failed");
    expect(job.error?.message).toContain("failed with policy abort");
    expect(calls).toEqual(["/fail-guard"]);
    expect(h.harness.databases.get("shop")?.get("public.customers")).toEqual([
      { id: 9, email: "z@x.io" },
    ]);
    const checkout = await checkouts.get("shop", started.checkout.id);
    expect(checkout.status).toBe("failed");
    expect(checkout.stash_state_id).not.toBeNull();
    expect(adapter.id).toBeTruthy();
  });

  it("after_snapshot hooks run with the new state's placeholders and land in the job result", async () => {
    const h = await createHarness();
    await bind(h, "after_snapshot", await h.request("notify", "/notify/{{state.name}}"));
    calls.length = 0;
    await createSettled(h.harness, PG);
    expect(calls).toEqual(["/notify/init"]);
  });
});

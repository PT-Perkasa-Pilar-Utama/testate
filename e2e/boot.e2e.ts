import { expect, test } from "@playwright/test";

import {
  bootApi,
  bootDir,
  bootEnv,
  bootEvents,
  bootFails,
  newKey,
  preMigrationCopies,
} from "./lib/boot.ts";
import {
  adminSession,
  call,
  draftFor,
  killDuringSnapshot,
  sealS3Credentials,
  seedProject,
  signIn,
  waitIdle,
} from "./lib/instance.ts";

// Every test spawns its own API on its own port and data dir; they must not overlap.
test.describe.configure({ mode: "serial" });

test("@story-123 @story-129 @story-130 boots from the built image under a sub-path and stops cleanly", async () => {
  test.setTimeout(120_000);
  const dir = bootDir("image");
  const booted = await bootApi(bootEnv(dir, newKey(), 3101, { TESTATE_BASE_PATH: "/testate" }), {
    entry: "apps/api/dist/index.js",
    readyPath: "/testate/api/v1/health/live",
  });
  // One volume: the boot creates its own layout under the data dir.
  expect(preMigrationCopies(dir)).toStrictEqual([]);
  const live = await fetch(`${booted.base}/testate/api/v1/health/live`);
  expect(live.status).toBe(204);
  const ready = await fetch(`${booted.base}/testate/api/v1/health/ready`);
  expect(ready.status).toBe(204);
  // The sub-path is the only path: the bare route is not served.
  expect((await fetch(`${booted.base}/api/v1/health/live`)).status).toBe(404);
  const events = bootEvents(dir);
  expect(events.length).toBe(1);
  expect(await booted.stop("SIGTERM")).toBe(0);
});

test("@story-122 the metadata database is copied before migrations and the last three stay", async () => {
  test.setTimeout(180_000);
  const dir = bootDir("copies");
  const key = newKey();
  for (let boot = 0; boot < 5; boot += 1) {
    const booted = await bootApi(bootEnv(dir, key, 3102));
    expect(await booted.stop()).toBe(0);
  }
  // The first boot has no database to copy; the four after it keep three copies.
  expect(preMigrationCopies(dir).length).toBe(3);
  const events = bootEvents(dir);
  expect(events[0]?.op.pre_migration_copy).toBe(false);
  expect(events[4]?.op.pre_migration_copy).toBe(true);
  expect(events[4]?.op.migrations_applied).toStrictEqual([]);
});

test("@story-124 the instance refuses to start without an active key", async () => {
  test.setTimeout(120_000);
  const dir = bootDir("nokey");
  const env = bootEnv(dir, "", 3103);
  const refusal = await bootFails(env);
  expect(refusal.code).toBe(78);
  expect(refusal.stderr).toContain("TESTATE_SECRETS_ACTIVE_KEY");
});

test("@story-125 @story-126 @story-127 rotates a key, refuses an unopenable store, and declares loss", async () => {
  test.setTimeout(240_000);
  const dir = bootDir("keys");
  const first = newKey();
  const second = newKey();
  const stranger = newKey();

  const booted = await bootApi(bootEnv(dir, first, 3104));
  const session = await adminSession(booted.base);
  await sealS3Credentials(session);
  expect(await booted.stop()).toBe(0);

  // 126: the configured key opens nothing that was sealed; the boot refuses before it writes.
  const refusal = await bootFails(bootEnv(dir, stranger, 3104));
  expect(refusal.code).toBe(78);
  expect(refusal.stderr).toContain("no configured key");

  // 125: new key first, old key second; the values are re-sealed under the new one.
  const rotated = await bootApi(bootEnv(dir, `${second},${first}`, 3104));
  expect(await rotated.stop()).toBe(0);
  const rotation = bootEvents(dir).at(-1);
  expect(rotation?.op.sealed_re_sealed).toBeGreaterThan(0);

  // 127: declared loss boots, names every unreadable value, and disables its owner.
  const declared = await bootApi(
    bootEnv(dir, stranger, 3104, { TESTATE_SECRETS_ACCEPT_UNREADABLE: "true" })
  );
  expect(declared.stderr()).toContain("unreadable sealed value");
  const event = bootEvents(dir).at(-1);
  expect(event?.op.sealed_unreadable).toBeGreaterThan(0);
  expect(await declared.stop()).toBe(0);
});

const FIXED_HOSTS = ["169.254.169.254", "metadata.google.internal"];

type Settings = { data: { netguard: { fixed: string[] }; disabled_adapters?: string[] } };
type Failure = { error: { code: string; details: { reason: string; matched: string } } };
type AdapterRow = { data: { id: string; status: string } };

test("@story-32 @story-33 fixed targets stay blocked and a deny-list change disables its adapters", async () => {
  test.setTimeout(180_000);
  const dir = bootDir("netguard");
  const booted = await bootApi(bootEnv(dir, newKey(), 3105));
  const session = await adminSession(booted.base);
  const adapterId = await seedProject(session, "guard");
  await waitIdle(session);

  // 32: the fixed list is not the admin deny list, and an empty deny list does not lift it.
  const settings = await call<Settings>(session, "GET", "settings");
  expect(settings.json.data.netguard.fixed).toEqual(expect.arrayContaining(FIXED_HOSTS));
  for (const host of FIXED_HOSTS) {
    const attempt = await call<Failure>(
      session,
      "POST",
      "projects/guard/adapters/test",
      draftFor(host)
    );
    expect(attempt.status).toBe(422);
    expect(attempt.json.error.code).toBe("HOST_BLOCKED");
    expect(attempt.json.error.details.reason).toBe("fixed");
  }

  // 33: the change re-checks every adapter and disables the ones the list now blocks.
  const patched = await call<Settings>(session, "PATCH", "settings", {
    netguard: { deny: ["127.0.0.1:54320"] },
  });
  expect(patched.json.data.disabled_adapters).toStrictEqual([adapterId]);
  const adapter = await call<AdapterRow>(session, "GET", `projects/guard/adapters/${adapterId}`);
  expect(adapter.json.data.status).toBe("disabled");
  expect(await booted.stop()).toBe(0);
});

test("@story-107 a job killed with the instance comes back interrupted", async () => {
  test.setTimeout(180_000);
  const dir = bootDir("restart");
  const key = newKey();
  const first = await bootApi(bootEnv(dir, key, 3106));
  const session = await adminSession(first.base);
  const adapterId = await seedProject(session, "restart");
  await waitIdle(session);
  // SIGKILL runs no shutdown hook, so the job row stays `running` on disk.
  const jobId = await killDuringSnapshot(session, first, "restart", adapterId);

  const second = await bootApi(bootEnv(dir, key, 3106));
  expect(bootEvents(dir).at(-1)?.op.jobs_interrupted).toBeGreaterThan(0);
  const back = await adminSession(second.base);
  const job = await call<{ data: { status: string } }>(back, "GET", `jobs/${jobId}`);
  expect(job.json.data.status).toBe("interrupted");
  const states = await call<{ data: { name: string; status: string }[] }>(
    back,
    "GET",
    "projects/restart/states?limit=10"
  );
  expect(states.json.data.map((state) => state.status)).toContain("failed");
  expect(await second.stop()).toBe(0);
});

test("an admin locked out of its own instance recovers through the environment", async () => {
  test.setTimeout(180_000);
  const dir = bootDir("recovery");
  const key = newKey();
  const first = await bootApi(bootEnv(dir, key, 3107));
  const session = await adminSession(first.base);
  expect((await call(session, "GET", "auth/me")).status).toBe(200);
  expect(await first.stop()).toBe(0);

  // The operator sets the flag and restarts; the password in the environment takes over.
  const recovered = await bootApi(
    bootEnv(dir, key, 3107, {
      TESTATE_ADMIN_PASSWORD: "recovered-password-1",
      TESTATE_ADMIN_PASSWORD_RESET: "true",
    })
  );
  expect(recovered.stderr()).toContain("TESTATE_ADMIN_PASSWORD_RESET");
  expect(bootEvents(dir).at(-1)?.op.admin_password_reset).toBe(true);
  // The session the admin had before the reset is gone with it.
  expect((await call(session, "GET", "auth/me")).status).toBe(401);
  const back = await signIn(recovered.base, "recovered-password-1");
  expect(back.mustChangePassword).toBe(true);
  expect(await recovered.stop()).toBe(0);

  // A name that is no admin refuses the boot rather than minting one.
  const refusal = await bootFails(
    bootEnv(dir, key, 3107, {
      TESTATE_ADMIN_USER: "nobody",
      TESTATE_ADMIN_PASSWORD: "recovered-password-1",
      TESTATE_ADMIN_PASSWORD_RESET: "true",
    })
  );
  expect(refusal.code).toBe(78);
  expect(refusal.stderr).toContain("no user named nobody");
});

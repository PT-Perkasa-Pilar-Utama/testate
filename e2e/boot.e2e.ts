import { expect, test } from "@playwright/test";

import {
  adminSession,
  bootApi,
  bootDir,
  bootEnv,
  bootEvents,
  bootFails,
  newKey,
  preMigrationCopies,
  sealS3Credentials,
} from "./lib/boot.ts";

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

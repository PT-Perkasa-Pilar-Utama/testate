import { expect, test } from "@playwright/test";

import { bootApi, bootDir, bootEnv, newKey } from "./lib/boot.ts";
import type { Booted } from "./lib/boot.ts";
import { adminSession, call } from "./lib/instance.ts";
import type { AdminSession } from "./lib/instance.ts";
import { hostKeyFingerprint, runSqlite } from "./lib/sql.ts";

const STAMP = Date.now().toString(36);

let booted: Booted;
let session: AdminSession;
let dir = "";

test.beforeAll(async () => {
  dir = bootDir("hostkey");
  booted = await bootApi(bootEnv(dir, newKey(), 3113));
  session = await adminSession(booted.base);
});

// The instance stops even when the test below fails, so the port is free for the next run.
test.afterAll(async () => {
  await booted.stop();
});

type Entries = { data: { name: string }[] };
type Failure = {
  error: { code: string; message: string; details: { details: { fingerprint: string } } };
};

test("@story-97 SFTP remembers the first host key and refuses a changed one until it is accepted", async () => {
  test.setTimeout(180_000);
  const slug = `sftp-${STAMP}`;
  await call(session, "PATCH", "settings", { netguard: { deny: [] } });
  await call(session, "POST", "projects", { slug, name: slug });
  const created = await call<{ data: { adapter: { id: string } } }>(
    session,
    "POST",
    `projects/${slug}/adapters`,
    {
      kind: "storage",
      engine: "sftp",
      name: "drop",
      config: { host: "127.0.0.1", port: 22220, user: "testate", root_path: "/upload" },
      secrets: { password: "testate" },
    }
  );
  expect(created.status).toBe(201);
  const adapterId = created.json.data.adapter.id;

  // The first connection trusts the key the server presents and remembers it.
  const first = await call<Entries>(
    session,
    "GET",
    `projects/${slug}/adapters/${adapterId}/entries`
  );
  expect(first.status).toBe(200);
  const trusted = hostKeyFingerprint(dir, adapterId);
  expect(trusted).toContain("SHA256:");

  // The server presents a different key: every connection refuses and names the fingerprint.
  runSqlite(dir, [
    `UPDATE known_host_keys SET fingerprint = 'SHA256:rotated-away' WHERE adapter_id = '${adapterId}'`,
  ]);
  const refused = await call<Failure>(
    session,
    "GET",
    `projects/${slug}/adapters/${adapterId}/entries`
  );
  expect(refused.status).toBe(409);
  expect(refused.json.error.code).toBe("CONFLICT");
  expect(refused.json.error.message).toContain("host key changed");
  // The fingerprint in the refusal is the one the server presents, not the one stored.
  expect(refused.json.error.details.details.fingerprint).toBe(trusted);

  // Accepting the new key restores the connection.
  const accepted = await call(
    session,
    "POST",
    `projects/${slug}/adapters/${adapterId}/host-key/accept`,
    { fingerprint: trusted }
  );
  expect(accepted.status).toBe(204);
  const after = await call<Entries>(
    session,
    "GET",
    `projects/${slug}/adapters/${adapterId}/entries`
  );
  expect(after.status).toBe(200);
});

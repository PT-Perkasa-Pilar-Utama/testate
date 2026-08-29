/** The API-side setup for the click-through: first login, password change, deny list, and the dev seed. */
import * as v from "valibot";
import type { JsonObject } from "@testate/shared";
import { jsonValueSchema } from "@testate/shared";

type Session = { cookie: string };

async function api(
  port: number,
  session: Session | null,
  path: string,
  body: JsonObject
): Promise<Response> {
  const headers = new Headers({ "Content-Type": "application/json", "X-Testate-Request": "1" });
  if (session !== null) headers.set("Cookie", session.cookie);
  return fetch(`http://localhost:${port}/api/v1${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function login(port: number, password: string): Promise<Session> {
  const response = await api(port, null, "/auth/login", { username: "admin", password });
  if (!response.ok) throw new Error(`login failed: ${response.status} ${await response.text()}`);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (cookie === undefined) throw new Error("login set no cookie");
  return { cookie };
}

/** The bootstrap admin must change its password before anything else; the reset recreates it. */
export async function setupThroughApi(
  port: number,
  adminPassword: string,
  finalPassword: string
): Promise<JsonObject> {
  let session = await login(port, adminPassword);
  await api(port, session, "/auth/password", { current: adminPassword, next: finalPassword });
  // The default deny list blocks loopback; the compose engines live there on a dev box.
  await fetch(`http://localhost:${port}/api/v1/settings`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-Testate-Request": "1",
      Cookie: session.cookie,
    },
    body: JSON.stringify({ netguard: { deny: [] } }),
  });
  const reset = await api(port, session, "/admin/reset-state", { seed: "dev", confirm: "reset" });
  const report = v.parse(v.record(v.string(), jsonValueSchema), await reset.json());
  session = await login(port, adminPassword);
  await api(port, session, "/auth/password", { current: adminPassword, next: finalPassword });
  return report;
}

import { lookup } from "node:dns/promises";
import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import type { HostSuggestion } from "@testate/shared";

type Interfaces = Record<string, { address: string; family: string; internal: boolean }[]>;

/** Docker and Podman each leave a file at the root of a container and nowhere else. */
export function inContainer(): boolean {
  return existsSync("/.dockerenv") || existsSync("/run/.containerenv");
}

/**
 * The machine's own addresses are worth offering only when Testate runs natively: then a database
 * on the same machine sits behind one of them. Inside a container they are the container's own
 * bridge address, which no database is behind, and the button led a person the wrong way.
 */
export function pickHosts(interfaces: Interfaces, contained: boolean): HostSuggestion[] {
  if (contained) return [];
  const found: HostSuggestion[] = [];
  for (const [name, addresses] of Object.entries(interfaces)) {
    for (const address of addresses) {
      if (address.family !== "IPv4" || address.internal) continue;
      found.push({ host: address.address, label: `This machine (${name})` });
    }
  }
  return found;
}

/**
 * Addresses worth offering under the Host field, from where Testate is actually running.
 *
 * The browser cannot answer this. It has no way to read the machine's own address, and even if it
 * could it would be the wrong machine: the engine dials from the server, so the host has to be one
 * the server can reach.
 *
 * `host.docker.internal` is offered only when it resolves. The name exists inside a container that
 * was started with it and nowhere else, so a fixed button for it hands anyone else the exact
 * failure the button was meant to save them from.
 */
export async function suggestHosts(): Promise<HostSuggestion[]> {
  const interfaces: Interfaces = {};
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    interfaces[name] = addresses ?? [];
  }
  const found = pickHosts(interfaces, inContainer());
  try {
    await lookup("host.docker.internal");
    found.push({ host: "host.docker.internal", label: "Docker host" });
  } catch {
    // Not started with the name, so it would not resolve for the engine either.
  }
  return found;
}

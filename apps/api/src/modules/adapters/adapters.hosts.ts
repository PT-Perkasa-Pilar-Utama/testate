import { lookup } from "node:dns/promises";
import { networkInterfaces } from "node:os";
import type { HostSuggestion } from "@testate/shared";

/**
 * Addresses worth offering under the Host field, from where Testate is actually running.
 *
 * The browser cannot answer this. It has no way to read the machine's own address, and even if it
 * could it would be the wrong machine: the engine dials from the server, so the host has to be one
 * the server can reach.
 *
 * `host.docker.internal` is offered only when it resolves. The name exists inside a container and
 * nowhere else, so a fixed button for it hands anyone running Testate natively the exact failure
 * the button was meant to save them from.
 */
export async function suggestHosts(): Promise<HostSuggestion[]> {
  const found: HostSuggestion[] = [];
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== "IPv4" || address.internal) continue;
      found.push({ host: address.address, label: `This machine (${name})` });
    }
  }
  try {
    await lookup("host.docker.internal");
    found.push({ host: "host.docker.internal", label: "Docker host" });
  } catch {
    // Not in a container, so the name would not resolve for the engine either.
  }
  return found;
}

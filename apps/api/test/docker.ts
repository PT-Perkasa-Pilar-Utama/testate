import type { JsonValue } from "@testate/shared";

import { AppError } from "../src/lib/http/index.ts";
import type { DockerAnswer, DockerApi, DockerRequest } from "../src/lib/logs/docker/api.ts";
import { dockerAccess } from "../src/lib/logs/docker/connect.ts";
import type { OpenDocker } from "../src/modules/adapters/adapters.docker.api.ts";

/** One log line of a fake container: its stamp in nanoseconds, its stream and its text. */
export type FakeLine = { nanos: bigint; stream: "stdout" | "stderr"; text: string };

export type FakeContainer = {
  name: string;
  lines: FakeLine[];
  tty?: boolean;
  driver?: string;
};

/** Docker's fixed nine-digit RFC 3339 stamp. */
export function stampOf(nanos: bigint): string {
  const seconds = new Date(Number(nanos / 1_000_000n)).toISOString().slice(0, 19);
  return `${seconds}.${(nanos % 1_000_000_000n).toString().padStart(9, "0")}Z`;
}

function frame(line: FakeLine, tty: boolean): Buffer {
  const payload = Buffer.from(`${stampOf(line.nanos)} ${line.text}\n`);
  if (tty) return payload;
  const header = Buffer.alloc(8);
  header[0] = line.stream === "stdout" ? 1 : 2;
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

/**
 * The lines a json-file container answers, as measured on Engine 29.5 (K5): `tail` first, then
 * `since` starts at the first line stamped at or after it, `until` stops at the first after it.
 */
function logLines(container: FakeContainer, request: Extract<DockerRequest, { kind: "logs" }>) {
  let kept = request.tail === "all" ? container.lines : container.lines.slice(-request.tail);
  const { since, until } = request;
  if (since !== undefined) {
    const start = kept.findIndex((line) => line.nanos >= since);
    kept = start === -1 ? [] : kept.slice(start);
  }
  if (until !== undefined) {
    const stop = kept.findIndex((line) => line.nanos > until);
    kept = stop === -1 ? kept : kept.slice(0, stop);
  }
  return kept;
}

const json = (status: number, body: JsonValue): DockerAnswer => ({
  status,
  body: Buffer.from(JSON.stringify(body)),
  capped: false,
});

/** A daemon that answers the five calls for `containers`, and records every request. */
export function fakeDocker(
  containers: FakeContainer[],
  version = "1.54"
): DockerApi & { requests: DockerRequest[]; closed: number } {
  const requests: DockerRequest[] = [];
  const api = {
    requests,
    closed: 0,
    async get(request: DockerRequest, capBytes: number): Promise<DockerAnswer> {
      requests.push(request);
      if (request.kind === "ping") return { status: 200, body: Buffer.from("OK"), capped: false };
      if (request.kind === "version") return json(200, { ApiVersion: version, Version: "29.5.2" });
      if (request.kind === "containers")
        return json(
          200,
          containers.map((item) => ({ Names: [`/${item.name}`] }))
        );
      const container = containers.find((item) => item.name === request.container);
      if (container === undefined)
        return json(404, { message: `No such container: ${request.container}` });
      if (request.kind === "inspect")
        return json(200, {
          Name: `/${container.name}`,
          Config: { Tty: container.tty ?? false },
          HostConfig: { LogConfig: { Type: container.driver ?? "json-file" } },
        });
      const body = Buffer.concat(
        logLines(container, request).map((line) => frame(line, container.tty ?? false))
      );
      return { status: 200, body: body.subarray(0, capBytes), capped: body.length > capBytes };
    },
    async close() {
      api.closed += 1;
    },
  };
  return api;
}

/** `count` stdout lines a second apart from `start`, texts `line 1` and on. */
/** Where `fakeLines` starts: 2026-10-10T13:46:40Z. */
export const FAKE_START = 1_791_640_000_000_000_000n;

export function fakeLines(count: number, start = FAKE_START): FakeLine[] {
  return Array.from({ length: count }, (_, n) => ({
    nanos: start + BigInt(n) * 1_000_000_000n,
    stream: "stdout" as const,
    text: `line ${n + 1}`,
  }));
}

/**
 * The harness's Docker hosts by host name, the SSH ones behind a host key the test can change. Over
 * SSH, a host with no entry refuses the socket, as one whose user is not in the `docker` group.
 */
export function memoryOpenDocker(
  hosts: Map<string, FakeContainer[]>,
  hostKey: { current: string }
): OpenDocker {
  return (connection) => {
    if (connection.transport === "tcp") return fakeDocker(hosts.get(connection.host) ?? []);
    const { login, socketPath } = connection;
    const containers = hosts.get(login.host);
    const daemon = fakeDocker(containers ?? []);
    return {
      async get(request, capBytes) {
        if (!login.verifyHostKey({ type: "ssh-ed25519", fingerprint: hostKey.current }))
          throw new AppError("CONFLICT", "the SSH host key changed", {
            reason: "host_key_changed",
          });
        if (containers === undefined) throw dockerAccess(login.user, socketPath);
        return daemon.get(request, capBytes);
      },
      close: () => daemon.close(),
    };
  };
}

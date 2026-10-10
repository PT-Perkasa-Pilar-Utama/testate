/**
 * The only calls Testate makes to a Docker daemon (#88; K2 of docs/decisions/2026-10-10-docker.md):
 * five `GET` paths, built here from a request, never from a string a person typed. Logs always
 * ask `follow=0`, so no call stays open. One HTTP client serves both transports: it speaks over
 * whatever channel the transport opens (an SSH socket channel, a TCP or TLS socket).
 */
import http from "node:http";
import type { Duplex } from "node:stream";
import { DOCKER_CONTAINER } from "@testate/shared";

import { AppError } from "../../http/index.ts";
import { secondsOf } from "./frames.ts";

export type DockerRequest =
  | { kind: "ping" }
  | { kind: "version" }
  | { kind: "containers" }
  | { kind: "inspect"; container: string }
  | {
      kind: "logs";
      container: string;
      tail: number | "all";
      since?: bigint | undefined;
      until?: bigint | undefined;
    };

export type DockerAnswer = { status: number; body: Buffer; capped: boolean };

export type DockerApi = {
  get(request: DockerRequest, capBytes: number): Promise<DockerAnswer>;
  close(): Promise<void>;
};

/** A fresh channel for one request; HTTP/1.1 with `Connection: close` ends it. */
export type OpenChannel = () => Promise<Duplex>;

const REQUEST_TIMEOUT_MS = 30_000;

function containerPath(container: string): string {
  if (!DOCKER_CONTAINER.test(container))
    throw new AppError(
      "VALIDATION_ERROR",
      "that is not a container name Testate will send to Docker"
    );
  return `/containers/${encodeURIComponent(container)}`;
}

function logsQuery(request: Extract<DockerRequest, { kind: "logs" }>): string {
  const query = new URLSearchParams({
    stdout: "1",
    stderr: "1",
    timestamps: "1",
    follow: "0",
    tail: request.tail === "all" ? "all" : String(Math.max(1, Math.floor(request.tail))),
  });
  if (request.since !== undefined) query.set("since", secondsOf(request.since));
  if (request.until !== undefined) query.set("until", secondsOf(request.until));
  return query.toString();
}

export function pathOf(request: DockerRequest): string {
  switch (request.kind) {
    case "ping":
      return "/_ping";
    case "version":
      return "/version";
    case "containers":
      return "/containers/json?all=1";
    case "inspect":
      return `${containerPath(request.container)}/json`;
    case "logs":
      return `${containerPath(request.container)}/logs?${logsQuery(request)}`;
  }
}

/** One `GET` over `channel`; the body stops at `capBytes` and says so. */
function getOver(channel: Duplex, path: string, capBytes: number): Promise<DockerAnswer> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        method: "GET",
        path,
        headers: { Host: "docker", Connection: "close" },
        createConnection: () => channel,
      },
      (response) => {
        const parts: Buffer[] = [];
        let size = 0;
        const done = (capped: boolean): void =>
          resolve({ status: response.statusCode ?? 0, body: Buffer.concat(parts), capped });
        response.on("data", (chunk: Buffer) => {
          parts.push(chunk);
          size += chunk.length;
          if (size < capBytes) return;
          response.destroy();
          done(true);
        });
        response.on("end", () => done(false));
        response.on("error", reject);
      }
    );
    // Not request.setTimeout: it calls the socket's, and an SSH channel has none.
    const timer = setTimeout(
      () => request.destroy(new AppError("ADAPTER_UNREACHABLE", "Docker did not answer in time")),
      REQUEST_TIMEOUT_MS
    );
    request.on("close", () => clearTimeout(timer));
    request.on("error", reject);
    request.end();
  });
}

export function createDockerApi(open: OpenChannel, close: () => Promise<void>): DockerApi {
  return {
    async get(request, capBytes) {
      const path = pathOf(request);
      return getOver(await open(), path, capBytes);
    },
    close,
  };
}

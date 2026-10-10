/**
 * A `docker` adapter's read (#88; K3–K5 of docs/decisions/2026-10-10-docker.md): its connection,
 * the source's container, one page by position, each line parsed by the source's format and masked
 * as every log is for viewers and agents (Q5).
 */
import { dockerSourceSchema } from "@testate/shared";
import type { Actor, DockerSource, LogsQuery } from "@testate/shared";
import * as v from "valibot";

import { AppError } from "../../lib/http/index.ts";
import type { RawEntry } from "../../lib/logs/chunk.ts";
import type { DockerLine } from "../../lib/logs/docker/frames.ts";
import { containerReader, readContainer } from "../../lib/logs/docker/read.ts";
import { parserFor } from "../../lib/logs/parse.ts";
import type { LineParser } from "../../lib/logs/parse.ts";
import { passes } from "../../lib/logs/read.ts";
import { READABLE_DRIVERS, containerFacts } from "../adapters/adapters.docker.api.ts";
import type { DockerResolver } from "../adapters/adapters.docker.api.ts";
import type { AdapterRecord } from "../adapters/adapters.repository.ts";
import { answerOf } from "./logs.service.ts";
import type { LogsAnswer } from "./logs.service.ts";

export type DockerReader = (
  actor: Actor,
  adapter: AdapterRecord,
  query: LogsQuery
) => Promise<LogsAnswer>;

/** The format's time and level when it has them; else Docker's stamp and `info` (K4). */
function rawOf(line: DockerLine, parse: LineParser, container: string): RawEntry {
  const parsed = parse(line.text);
  const stream = line.stream === null ? {} : { stream: line.stream };
  return {
    time: parsed.time ?? Number(line.nanos / 1_000_000n),
    level: parsed.level ?? "info",
    file: container,
    message: parsed.message,
    fields: parsed.fields === null && line.stream === null ? null : { ...parsed.fields, ...stream },
    offset: 0,
  };
}

function sourceOf(sources: DockerSource[], name: string): DockerSource {
  const source = sources.find((candidate) => candidate.name === name);
  if (source === undefined)
    throw new AppError("NOT_FOUND", "log source not found", {
      sources: sources.map((item) => item.name),
    });
  return v.parse(dockerSourceSchema, source);
}

export function createDockerReader(dockers: DockerResolver): DockerReader {
  return async (actor, adapter, query) => {
    const trustAs = actor.kind === "user" ? actor.id : null;
    const { config, api } = await dockers.resolve(adapter.project_id, adapter.id, trustAs);
    try {
      const source = sourceOf(config.sources, query.source);
      const facts = await containerFacts(api, source.container);
      if (facts === null)
        throw new AppError("NOT_FOUND", `no container is named ${source.container} on this host`, {
          reason: "container_missing",
        });
      if (!READABLE_DRIVERS.has(facts.driver))
        throw new AppError(
          "ENGINE_UNSUPPORTED",
          `${source.container} logs to ${facts.driver}, which Docker cannot read back`,
          {
            reason: "log_driver",
          }
        );
      const read = await readContainer(containerReader(api, source.container, facts.tty), query);
      const parse = parserFor(source);
      const entries = read.lines
        .map((line) => rawOf(line, parse, source.container))
        .filter((entry) => passes(entry, query, false));
      return answerOf(
        { ...read, entries, untimed: false, filesOpened: 1, bytesRead: read.bytes },
        source,
        actor,
        adapter.name
      );
    } finally {
      await api.close();
    }
  };
}

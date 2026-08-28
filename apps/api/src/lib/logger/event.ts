import type { JsonObject, JsonValue } from "@testate/shared";

export type EventKind = "request" | "job" | "boot" | "shutdown";
export type Level = "info" | "warn" | "error";
export type Section =
  | "service"
  | "request"
  | "job"
  | "actor"
  | "project"
  | "adapter"
  | "op"
  | "engine"
  | "error";

export type Fields = JsonObject;

export type EmitMeta = { status?: number; durationMs?: number };

export type WideEventRecord = {
  ts: string;
  kind: EventKind;
  level: Level;
  sampled: boolean;
  status: number | null;
  durationMs: number | null;
  sections: Partial<Record<Section, Fields>>;
};

type ErrorSection = {
  code: string;
  type: string;
  message: string;
  retriable: boolean;
  details?: Fields;
  stack?: string;
};

const FORBIDDEN_KEYS = new Set(["password", "token", "secret", "__sealed", "connection_string"]);

export class RedactionError extends Error {
  constructor(key: string) {
    super(`wide event refuses field "${key}"`);
    this.name = "RedactionError";
  }
}

function isFields(value: JsonValue): value is Fields {
  return (
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}

function assertSafe(fields: Fields): void {
  for (const [key, value] of Object.entries(fields)) {
    if (FORBIDDEN_KEYS.has(key)) throw new RedactionError(key);
    if (isFields(value)) assertSafe(value);
  }
}

function deepMerge(target: Fields, source: Fields): Fields {
  const out = { ...target };
  for (const [key, value] of Object.entries(source)) {
    const existing = out[key];
    out[key] =
      existing !== undefined && isFields(existing) && isFields(value)
        ? deepMerge(existing, value)
        : value;
  }
  return out;
}

function deriveLevel(sections: WideEventRecord["sections"], status: number | undefined): Level {
  if (sections.error !== undefined) return "error";
  if (status !== undefined && status >= 500) return "error";
  if (status !== undefined && status >= 400) return "warn";
  const jobStatus = sections.job?.["status"];
  if (jobStatus === "partial" || jobStatus === "failed" || jobStatus === "interrupted")
    return "warn";
  return "info";
}

/** One event per request or job, built during the lifecycle, emitted once. */
export class WideEvent {
  readonly kind: EventKind;
  readonly startedAt: number;
  private readonly sections: Partial<Record<Section, Fields>> = {};
  private emitted = false;

  constructor(
    kind: EventKind,
    private readonly sink: (record: WideEventRecord) => void
  ) {
    this.kind = kind;
    this.startedAt = performance.now();
  }

  add(section: Section, fields: Fields): void {
    assertSafe(fields);
    this.sections[section] = { ...fields };
  }

  merge(section: Section, fields: Fields): void {
    assertSafe(fields);
    this.sections[section] = deepMerge(this.sections[section] ?? {}, fields);
  }

  push(section: Section, key: string, item: Fields): void {
    assertSafe(item);
    const current = this.sections[section] ?? {};
    const existing = current[key];
    const list = Array.isArray(existing) ? [...existing] : [];
    list.push({ ...item });
    this.sections[section] = { ...current, [key]: list };
  }

  error(
    cause: unknown,
    extra: { code?: string; retriable?: boolean; details?: Fields; stacks?: boolean } = {}
  ): void {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    const section: ErrorSection = {
      code: extra.code ?? "INTERNAL",
      type: error.name,
      message: error.message,
      retriable: extra.retriable ?? false,
    };
    if (extra.details !== undefined) section.details = extra.details;
    if (extra.stacks === true && error.stack !== undefined) section.stack = error.stack;
    this.sections.error = section;
  }

  get(section: Section): Fields | undefined {
    return this.sections[section];
  }

  emit(meta: EmitMeta = {}): void {
    if (this.emitted) return;
    this.emitted = true;
    const durationMs = meta.durationMs ?? Math.round(performance.now() - this.startedAt);
    this.sink({
      ts: new Date().toISOString(),
      kind: this.kind,
      level: deriveLevel(this.sections, meta.status),
      sampled: true,
      status: meta.status ?? null,
      durationMs,
      sections: this.sections,
    });
  }
}

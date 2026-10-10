import { createSignal } from "solid-js";
import * as v from "valibot";
import type { Adapter, IngestForm, IngestFormInput, JsonObject } from "@testate/shared";
import {
  INGEST_CAP_MB_DEFAULT,
  INGEST_RETENTION_DEFAULT,
  ingestConfigSchema,
} from "@testate/shared";

import { humanMessage } from "@/lib/api-error.ts";
import { attempt, showToast } from "@/lib/toast.ts";
import { adaptersModel } from "../adapters/adapters.model.ts";
import { logsModel } from "./logs.model.ts";

/** "Push from your app" (#75; I8 of docs/decisions/2026-10-10-logs-tier.md). */
export const BLANK_INGEST: IngestFormInput = {
  name: "",
  retention_days: String(INGEST_RETENTION_DEFAULT),
  cap_mb: String(INGEST_CAP_MB_DEFAULT),
};

/** The create body: an ingest adapter is always read-only and carries no secret (I1). */
export function toIngestBody(input: IngestForm): JsonObject {
  return {
    kind: "logs",
    engine: "ingest",
    name: input.name.trim(),
    mode: "read_only",
    config: { retention_days: input.retention_days, cap_mb: input.cap_mb },
    secrets: {},
  };
}

export function toIngestPatch(input: IngestForm): JsonObject {
  return {
    name: input.name.trim(),
    config: { retention_days: input.retention_days, cap_mb: input.cap_mb },
  };
}

/** The dialog's seed for an adapter being edited. */
export function ingestDraftFrom(adapter: Pick<Adapter, "name" | "config">): IngestFormInput {
  const config = v.parse(ingestConfigSchema, adapter.config);
  return {
    name: adapter.name,
    retention_days: String(config.retention_days),
    cap_mb: String(config.cap_mb),
  };
}

/** A ready line to paste: one `testate` line from a service named `api` (25 §25.7). */
export function curlFor(url: string, token: string): string {
  const line = '{"level":"info","message":"hello from my app","service":{"name":"api"}}';
  return [
    `curl -X POST ${url} \\`,
    `  -H "Authorization: Bearer ${token}" \\`,
    `  -H "Content-Type: application/x-ndjson" \\`,
    `  --data-binary '${line}'`,
  ].join("\n");
}

/** A token on screen once: right after create, or after a rotation. */
export type Revealed = { name: string; token: string; url: string };

export type IngestPresenter = {
  open: () => boolean;
  /** The adapter being edited, or null while one is being created. */
  editing: () => Adapter | null;
  seed: () => IngestFormInput;
  error: () => string | null;
  busy: () => boolean;
  openCreate: () => void;
  openEdit: (adapter: Adapter) => void;
  close: () => void;
  save: (input: IngestForm) => Promise<void>;
  revealed: () => Revealed | null;
  copy: () => Promise<void>;
  dismiss: () => void;
  /** The adapter whose token the confirm dialog is about to replace. */
  rotating: () => Adapter | null;
  askRotate: (adapter: Adapter) => void;
  cancelRotate: () => void;
  rotate: () => Promise<void>;
  clearing: () => Adapter | null;
  askClear: (adapter: Adapter) => void;
  cancelClear: () => void;
  clear: () => Promise<void>;
};

export function createIngestPresenter(slug: () => string, onSaved: () => void): IngestPresenter {
  const [open, setOpen] = createSignal(false);
  const [editing, setEditing] = createSignal<Adapter | null>(null);
  const [seed, setSeed] = createSignal<IngestFormInput>(BLANK_INGEST);
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [revealed, setRevealed] = createSignal<Revealed | null>(null);
  const [rotating, setRotating] = createSignal<Adapter | null>(null);
  const [clearing, setClearing] = createSignal<Adapter | null>(null);
  const start = (adapter: Adapter | null, draft: IngestFormInput): void => {
    setEditing(adapter);
    setSeed(draft);
    setError(null);
    setOpen(true);
  };
  const run = async (task: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await task();
      setOpen(false);
      onSaved();
    } catch (cause: unknown) {
      setError(humanMessage(cause, "The log adapter could not be saved"));
    } finally {
      setBusy(false);
    }
  };
  return {
    open,
    editing,
    seed,
    error,
    busy,
    openCreate: () => start(null, BLANK_INGEST),
    openEdit: (adapter) => start(adapter, ingestDraftFrom(adapter)),
    close: () => setOpen(false),
    save: (input) => {
      const staticSlug = slug();
      const adapter = editing();
      if (adapter !== null)
        return run(async () => {
          await adaptersModel.update(staticSlug, adapter.id, toIngestPatch(input));
          showToast("Log adapter saved", "success");
        });
      return run(async () => {
        const result = await adaptersModel.create(staticSlug, toIngestBody(input));
        const token = result.ingest_token ?? null;
        const url = logsModel.pushUrl(result.adapter.id);
        if (token !== null) setRevealed({ name: result.adapter.name, token, url });
      });
    },
    revealed,
    copy: () => {
      const shown = revealed();
      if (shown === null) return Promise.resolve();
      return attempt(async () => {
        await navigator.clipboard.writeText(shown.token);
        showToast("Token copied", "success");
      });
    },
    dismiss: () => setRevealed(null),
    rotating,
    askRotate: (adapter) => setRotating(adapter),
    cancelRotate: () => setRotating(null),
    rotate: () => {
      const adapter = rotating();
      const staticSlug = slug();
      setRotating(null);
      if (adapter === null) return Promise.resolve();
      return attempt(async () => {
        const minted = await logsModel.rotateToken(staticSlug, adapter.id);
        setRevealed({
          name: adapter.name,
          token: minted.token,
          url: logsModel.pushUrl(adapter.id),
        });
      });
    },
    clearing,
    askClear: (adapter) => setClearing(adapter),
    cancelClear: () => setClearing(null),
    clear: () => {
      const adapter = clearing();
      const staticSlug = slug();
      setClearing(null);
      if (adapter === null) return Promise.resolve();
      return attempt(async () => {
        await logsModel.clear(staticSlug, adapter.id);
        showToast(`${adapter.name} cleared`, "success");
        onSaved();
      });
    },
  };
}

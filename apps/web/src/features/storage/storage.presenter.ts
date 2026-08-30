import { createSignal } from "solid-js";
import type { Entry, PreviewPayload } from "@testate/shared";
import * as v from "valibot";

import { attempt, showToast } from "@/lib/toast.ts";
import { ApiError } from "@/lib/api-client.ts";
import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { BINARY_EXTENSIONS, extensionOf, storageModel } from "./storage.model.ts";
import type { EntriesPage } from "./storage.model.ts";

export type Preview =
  | { kind: "payload"; entry: Entry; payload: PreviewPayload }
  | { kind: "binary"; entry: Entry; url: string };

export type StoragePresenter = {
  page: Refreshable<EntriesPage>;
  path: () => string;
  crumbs: () => { name: string; path: string }[];
  open: (path: string) => void;
  up: () => void;
  q: () => string;
  setQ: (q: string) => void;
  depth: () => number;
  next: () => void;
  previous: () => void;
  preview: () => Preview | null;
  /** The two faces of the open preview, narrowed for the view. */
  binaryUrl: () => string | null;
  payload: () => PreviewPayload | null;
  openPreview: (entry: Entry) => Promise<void>;
  closePreview: () => void;
  downloadUrl: (entry: Entry) => string;
  /** The fingerprint of a changed SFTP host key, from the CONFLICT the last listing raised. */
  changedKey: () => string | null;
  acceptHostKey: () => Promise<void>;
};

/** A screenful. The listing pages with a cursor, so a bucket with thousands of keys
 * used to arrive as one 200-row page taller than the window. */
const PAGE_SIZE = 50;

const hostKeyDetails = v.object({
  reason: v.literal("host_key_changed"),
  details: v.object({ fingerprint: v.string() }),
});

/** `exports/2026/08` → exports, 2026, 08 with the path each crumb opens. */
export function crumbsOf(path: string): { name: string; path: string }[] {
  const parts = path.split("/").filter((part) => part !== "");
  return parts.map((name, index) => ({ name, path: parts.slice(0, index + 1).join("/") }));
}

export function parentOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

export function createStoragePresenter(slug: () => string, id: () => string): StoragePresenter {
  const [path, setPath] = createSignal("");
  const [q, setQ] = createSignal("");
  const [cursors, setCursors] = createSignal<string[]>([]);
  const [preview, setPreview] = createSignal<Preview | null>(null);
  const [changedKey, setChangedKey] = createSignal<string | null>(null);
  const page = createRefreshable(async () => {
    const query = { path: path(), q: q(), limit: PAGE_SIZE };
    const cursor = cursors().at(-1);
    try {
      const result = await storageModel.entries(
        slug(),
        id(),
        cursor === undefined ? query : { ...query, cursor }
      );
      setChangedKey(null);
      return result;
    } catch (cause: unknown) {
      const changed = cause instanceof ApiError ? v.safeParse(hostKeyDetails, cause.details) : null;
      if (changed?.success === true) setChangedKey(changed.output.details.fingerprint);
      throw cause;
    }
  });
  const go = (next: string): void => {
    setPath(next);
    setCursors([]);
  };
  return {
    page,
    path,
    crumbs: () => crumbsOf(path()),
    open: go,
    up: () => go(parentOf(path())),
    q,
    setQ: (next) => {
      setQ(next);
      setCursors([]);
    },
    depth: () => cursors().length,
    next: () => {
      const cursor = page.value().page.next_cursor;
      if (cursor !== null) setCursors((current) => [...current, cursor]);
    },
    previous: () => setCursors((current) => current.slice(0, -1)),
    preview,
    openPreview: (entry) => {
      const staticSlug = slug();
      const staticId = id();
      if (BINARY_EXTENSIONS.has(extensionOf(entry.name))) {
        setPreview({
          kind: "binary",
          entry,
          url: storageModel.previewUrl(staticSlug, staticId, entry.path),
        });
        return Promise.resolve();
      }
      return attempt(async () => {
        setPreview({
          kind: "payload",
          entry,
          payload: await storageModel.preview(staticSlug, staticId, entry.path),
        });
      });
    },
    binaryUrl: () => {
      const current = preview();
      return current?.kind === "binary" ? current.url : null;
    },
    payload: () => {
      const current = preview();
      return current?.kind === "payload" ? current.payload : null;
    },
    closePreview: () => setPreview(null),
    downloadUrl: (entry) => storageModel.downloadUrl(slug(), id(), entry.path),
    changedKey,
    acceptHostKey: () => {
      const staticSlug = slug();
      const staticId = id();
      const staticKey = changedKey();
      if (staticKey === null) return Promise.resolve();
      return attempt(async () => {
        await storageModel.acceptHostKey(staticSlug, staticId, staticKey);
        showToast("Host key accepted", "success");
        page.refresh();
      });
    },
  };
}

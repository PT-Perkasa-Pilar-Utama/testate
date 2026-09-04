import { createSignal } from "solid-js";
import type { Adapter, Entry, PreviewPayload } from "@testate/shared";
import * as v from "valibot";

import { attempt, showToast } from "@/lib/toast.ts";
import { ApiError } from "@/lib/api-client.ts";
import { createRefreshable } from "@/lib/async.ts";
import type { Refreshable } from "@/lib/async.ts";
import { adaptersModel } from "../adapters/adapters.model.ts";
import { BINARY_EXTENSIONS, extensionOf, storageModel } from "./storage.model.ts";
import type { EntriesPage } from "./storage.model.ts";

export type Preview =
  | { kind: "payload"; entry: Entry; payload: PreviewPayload }
  | { kind: "binary"; entry: Entry; url: string };

export type StoragePresenter = {
  page: Refreshable<EntriesPage>;
  adapter: Refreshable<Adapter>;
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
  /** Whether this adapter is a sandbox, which is what decides if a file may be added or removed. */
  writable: () => boolean;
  upload: (file: File) => Promise<void>;
  /** The file the delete dialog is asking about, null when it is closed. */
  deleting: () => Entry | null;
  askDelete: (entry: Entry) => void;
  cancelDelete: () => void;
  remove: () => Promise<void>;
  /** The entry the rename dialog is asking about, null when it is closed. */
  renaming: () => Entry | null;
  askRename: (entry: Entry) => void;
  cancelRename: () => void;
  rename: (name: string) => Promise<void>;
  /** Whether the new-folder dialog is open. */
  addingFolder: () => boolean;
  askFolder: () => void;
  cancelFolder: () => void;
  makeFolder: (name: string) => Promise<void>;
  /** The paths ticked for a batch action, in the order they were ticked. */
  picked: () => string[];
  /** Whether the batch delete is waiting to be confirmed. */
  confirmingBatch: () => boolean;
  askBatch: () => void;
  cancelBatch: () => void;
  togglePicked: (entry: Entry) => void;
  clearPicked: () => void;
  /** Deletes every ticked entry, one call each, and says what it could not do. */
  removePicked: () => Promise<void>;
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
  const [deleting, setDeleting] = createSignal<Entry | null>(null);
  const [renaming, setRenaming] = createSignal<Entry | null>(null);
  const [addingFolder, setAddingFolder] = createSignal(false);
  const [picked, setPicked] = createSignal<string[]>([]);
  const [confirmingBatch, setConfirmingBatch] = createSignal(false);
  // The adapter says whether it may be written; the API refuses either way, and this is only so
  // the screen does not offer a button that always fails.
  const adapter = createRefreshable(() => adaptersModel.get(slug(), id()));
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
    adapter,
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
    writable: () => adapter.value().mode === "sandbox",
    upload: (file) => {
      const staticSlug = slug();
      const staticId = id();
      const staticTarget = path() === "" ? file.name : `${path()}/${file.name}`;
      return attempt(async () => {
        await storageModel.upload(staticSlug, staticId, staticTarget, file);
        page.refresh();
        showToast(`${file.name} uploaded.`, "success");
      });
    },
    deleting,
    askDelete: setDeleting,
    cancelDelete: () => setDeleting(null),
    remove: () => {
      const staticEntry = deleting();
      if (staticEntry === null) return Promise.resolve();
      const staticSlug = slug();
      const staticId = id();
      return attempt(async () => {
        await storageModel.remove(staticSlug, staticId, staticEntry.path);
        setDeleting(null);
        page.refresh();
        showToast(`${staticEntry.name} deleted.`, "success");
      });
    },
    renaming,
    askRename: setRenaming,
    cancelRename: () => setRenaming(null),
    rename: (name) => {
      const staticEntry = renaming();
      const staticSlug = slug();
      const staticId = id();
      const staticParent = path();
      if (staticEntry === null) return Promise.resolve();
      // The name, not the path: the dialog asks for a name and the folder it is in does not move.
      const target = staticParent === "" ? name : `${staticParent}/${name}`;
      return attempt(async () => {
        await storageModel.rename(staticSlug, staticId, staticEntry.path, target);
        setRenaming(null);
        page.refresh();
        showToast(`Renamed to ${name}.`, "success");
      });
    },
    addingFolder,
    askFolder: () => setAddingFolder(true),
    cancelFolder: () => setAddingFolder(false),
    makeFolder: (name) => {
      const staticSlug = slug();
      const staticId = id();
      const staticParent = path();
      const target = staticParent === "" ? name : `${staticParent}/${name}`;
      return attempt(async () => {
        await storageModel.makeDirectory(staticSlug, staticId, target);
        setAddingFolder(false);
        page.refresh();
        showToast(`${name} created.`, "success");
      });
    },
    picked,
    confirmingBatch,
    askBatch: () => setConfirmingBatch(true),
    cancelBatch: () => setConfirmingBatch(false),
    togglePicked: (entry) =>
      setPicked((current) =>
        current.includes(entry.path)
          ? current.filter((one) => one !== entry.path)
          : [...current, entry.path]
      ),
    clearPicked: () => setPicked([]),
    removePicked: () => {
      const staticSlug = slug();
      const staticId = id();
      const staticRows = page.value().data.filter((entry) => picked().includes(entry.path));
      if (staticRows.length === 0) return Promise.resolve();
      return attempt(async () => {
        // One call each, and one at a time: these go over SFTP and FTP, where a session runs a
        // single command, and a store answering slowly is not a reason to open eight connections.
        const failures: string[] = [];
        for (const entry of staticRows) {
          const remove =
            entry.kind === "directory" ? storageModel.removeDirectory : storageModel.remove;
          await remove(staticSlug, staticId, entry.path).catch(() => failures.push(entry.name));
        }
        setPicked([]);
        setConfirmingBatch(false);
        page.refresh();
        const done = staticRows.length - failures.length;
        showToast(
          failures.length === 0
            ? `${done} deleted.`
            : `${done} deleted. ${failures.length} could not be: ${failures.join(", ")}.`,
          failures.length === 0 ? "success" : "error"
        );
      });
    },
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

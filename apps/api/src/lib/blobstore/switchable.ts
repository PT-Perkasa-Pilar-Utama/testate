import type { BlobStore } from "./index.ts";

/** The live store: every module holds this one handle; a store migration swaps what is behind it. */
export type SwitchableBlobStore = BlobStore & {
  current(): BlobStore;
  swap(next: BlobStore): void;
};

export function createSwitchableBlobStore(initial: BlobStore): SwitchableBlobStore {
  let store = initial;
  return {
    current: () => store,
    swap(next) {
      store = next;
    },
    put: (stream, opts) => store.put(stream, opts),
    get: (hash) => store.get(hash),
    has: (hash) => store.has(hash),
    stat: (hash) => store.stat(hash),
    delete: (hash) => store.delete(hash),
    list: () => store.list(),
  };
}

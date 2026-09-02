/**
 * The files a compiled binary carries inside itself: the built SPA and the migrations, which the
 * image and a source checkout read from disk instead.
 *
 * Empty here on purpose. `scripts/binary/build-binaries.ts` writes the full list into this file
 * for the length of a `bun build --compile`, one `with { type: "file" }` import per file, and
 * puts this stub back when it is done. `ops.embedded.ts` unpacks the list at boot.
 */
export type EmbeddedFile = {
  /** Where the file goes, relative to the unpack root: `web/index.html`, `migrations/0001_init.sql`. */
  path: string;
  /** The path Bun gives an embedded file, which `Bun.file` reads from inside the binary. */
  file: string;
};

export const EMBEDDED: readonly EmbeddedFile[] = [];

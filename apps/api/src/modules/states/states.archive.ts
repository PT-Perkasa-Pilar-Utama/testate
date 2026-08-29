import type { ArchiveManifest, JsonObject, State } from "@testate/shared";
import {
  engineWarningSchema,
  introspectionSchema,
  jsonObjectSchema,
  manifestTableSchema,
} from "@testate/shared";
import * as v from "valibot";

import type { BlobStore } from "../../lib/blobstore/index.ts";
import { AppError } from "../../lib/http/index.ts";
import { readTar, writeTar } from "../../lib/snapshot/tar.ts";
import type { TarEntry } from "../../lib/snapshot/tar.ts";
import type { AdapterManifest } from "./states.manifests.ts";

const ARCHIVE_VERSION = 1;

const manifestFile = v.object({
  version: v.literal(ARCHIVE_VERSION),
  state: v.object({
    name: v.string(),
    notes: v.nullable(v.string()),
    tags: v.array(v.string()),
    kind: v.string(),
    created_at: v.string(),
  }),
  adapters: v.array(v.string()),
  key: v.literal("none"),
});

const adapterFile = v.object({
  adapter_name: v.string(),
  engine: v.string(),
  engine_version: v.string(),
  fingerprint: v.string(),
  consistency: v.picklist(["snapshot", "best_effort"]),
  tables: v.array(manifestTableSchema),
  introspection: introspectionSchema,
  warnings: v.array(engineWarningSchema),
});

export type ArchiveContents = {
  manifest: ArchiveManifest;
  adapters: Map<string, AdapterManifest>;
  blobs: Map<string, Uint8Array>;
};

function jsonEntry(name: string, value: JsonObject): TarEntry {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return { name, size: bytes.byteLength, body: new Blob([bytes]).stream() };
}

/** `manifest.json`, one `adapters/<id>.json` per adapter, then every blob once (15 §15.5). */
export function writeArchive(
  state: State,
  manifests: AdapterManifest[],
  blobs: BlobStore
): ReadableStream<Uint8Array> {
  const entries = async function* (): AsyncIterable<TarEntry> {
    yield jsonEntry("manifest.json", {
      version: ARCHIVE_VERSION,
      state: {
        name: state.name,
        notes: state.notes,
        tags: state.tags,
        kind: state.kind,
        created_at: state.created_at,
      },
      adapters: manifests.map((manifest) => manifest.adapter_id),
      key: "none",
    });
    const hashes = new Set<string>();
    for (const manifest of manifests) {
      const { adapter_id: _id, row_count: _rows, byte_count: _bytes, ...body } = manifest;
      yield jsonEntry(
        `adapters/${manifest.adapter_id}.json`,
        v.parse(jsonObjectSchema, JSON.parse(JSON.stringify(body)))
      );
      for (const table of manifest.tables) hashes.add(table.blob_hash);
    }
    for (const hash of hashes) {
      const stat = await blobs.stat(hash);
      if (stat === null) throw new AppError("NOT_FOUND", `blob ${hash} is missing from the store`);
      yield { name: `blobs/${hash}`, size: stat.size, body: blobs.get(hash) };
    }
  };
  return writeTar(entries());
}

function parseJson<TSchema extends v.GenericSchema>(
  schema: TSchema,
  bytes: Uint8Array,
  name: string
): v.InferOutput<TSchema> {
  try {
    return v.parse(schema, JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    throw new AppError("VALIDATION_ERROR", `${name} is not a Testate archive entry`, {
      entry: name,
    });
  }
}

/** Every entry parsed; blobs stay as bytes until the import job verifies their hashes. */
export function readArchive(bytes: Uint8Array): ArchiveContents {
  const adapters = new Map<string, AdapterManifest>();
  const blobs = new Map<string, Uint8Array>();
  let manifest: v.InferOutput<typeof manifestFile> | null = null;
  for (const entry of readTar(bytes)) {
    if (entry.name === "manifest.json") {
      manifest = parseJson(manifestFile, entry.bytes, entry.name);
      continue;
    }
    if (entry.name.startsWith("adapters/") && entry.name.endsWith(".json")) {
      const id = entry.name.slice("adapters/".length, -".json".length);
      const parsed = parseJson(adapterFile, entry.bytes, entry.name);
      const rows = parsed.tables.reduce((total, table) => total + table.rows, 0);
      const size = parsed.tables.reduce((total, table) => total + table.bytes, 0);
      adapters.set(id, { ...parsed, adapter_id: id, row_count: rows, byte_count: size });
      continue;
    }
    if (entry.name.startsWith("blobs/")) blobs.set(entry.name.slice("blobs/".length), entry.bytes);
  }
  if (manifest === null)
    throw new AppError("VALIDATION_ERROR", "the upload is not a Testate archive", {
      entry: "manifest.json",
    });
  return {
    manifest: {
      state: {
        name: manifest.state.name,
        notes: manifest.state.notes,
        tags: manifest.state.tags,
        created_at: manifest.state.created_at,
      },
      adapters: manifest.adapters.flatMap((id) => {
        const adapter = adapters.get(id);
        return adapter === undefined
          ? []
          : [
              {
                archive_adapter_id: id,
                adapter_name: adapter.adapter_name,
                engine: adapter.engine,
                engine_version: adapter.engine_version,
                tables: adapter.tables.length,
                row_count: adapter.row_count,
                byte_count: adapter.byte_count,
              },
            ];
      }),
    },
    adapters,
    blobs,
  };
}

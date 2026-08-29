import * as v from "valibot";

import { stateKindSchema, stateStatusSchema } from "../enums.ts";
import { actorSchema, engineWarningSchema, idSchema, timestampSchema } from "./common.ts";
import { adapterDraftSchema } from "./adapters.ts";

const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const stateNameSchema = v.pipe(
  v.string(),
  v.minLength(1),
  v.maxLength(80),
  v.check((name) => !UUID_LIKE.test(name), "a state name may not look like an id")
);

export const stateAdapterSchema = v.object({
  adapter_id: idSchema,
  adapter_name: v.string(),
  engine: v.string(),
  engine_version: v.string(),
  fingerprint: v.string(),
  consistency: v.picklist(["snapshot", "best_effort"]),
  removed: v.boolean(),
  row_count: v.number(),
  byte_count: v.number(),
  warnings: v.array(engineWarningSchema),
});
export type StateAdapter = v.InferOutput<typeof stateAdapterSchema>;

export const manifestTableSchema = v.object({
  schema: v.nullable(v.string()),
  name: v.string(),
  rows: v.number(),
  bytes: v.number(),
  blob_hash: v.string(),
  sort: v.picklist(["primary-key", "row-hash"]),
  warnings: v.array(engineWarningSchema),
});
export type ManifestTable = v.InferOutput<typeof manifestTableSchema>;

export const stateSchema = v.object({
  id: idSchema,
  name: stateNameSchema,
  kind: stateKindSchema,
  status: stateStatusSchema,
  protected: v.boolean(),
  notes: v.nullable(v.string()),
  tags: v.array(v.string()),
  parent_state_id: v.nullable(idSchema),
  stash_reason: v.nullable(v.picklist(["checkout", "import", "write-session"])),
  adapters: v.array(stateAdapterSchema),
  size_bytes: v.number(),
  actor: actorSchema,
  /** Null for a write-session stash: it is taken inline, not by a job. */
  job_id: v.nullable(idSchema),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export type State = v.InferOutput<typeof stateSchema>;

export const stateDetailSchema = v.object({
  ...stateSchema.entries,
  adapters: v.array(
    v.object({ ...stateAdapterSchema.entries, tables: v.array(manifestTableSchema) })
  ),
});
export type StateDetail = v.InferOutput<typeof stateDetailSchema>;

export const createStateSchema = v.object({
  name: stateNameSchema,
  notes: v.optional(v.pipe(v.string(), v.maxLength(4000))),
  tags: v.optional(v.array(v.pipe(v.string(), v.maxLength(40)))),
  adapter_ids: v.optional(v.array(idSchema)),
});
export type CreateStateInput = v.InferOutput<typeof createStateSchema>;

export const updateStateSchema = v.object({
  name: v.optional(stateNameSchema),
  notes: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(4000)))),
  tags: v.optional(v.array(v.pipe(v.string(), v.maxLength(40)))),
  protected: v.optional(v.boolean()),
});
export type UpdateStateInput = v.InferOutput<typeof updateStateSchema>;

export const stateTreeNodeSchema: v.GenericSchema<StateTreeNode> = v.lazy(() =>
  v.object({
    id: idSchema,
    name: v.string(),
    kind: stateKindSchema,
    created_at: timestampSchema,
    size_bytes: v.number(),
    is_head: v.boolean(),
    children: v.array(stateTreeNodeSchema),
  })
);
export type StateTreeNode = {
  id: string;
  name: string;
  kind: v.InferOutput<typeof stateKindSchema>;
  created_at: string;
  size_bytes: number;
  is_head: boolean;
  children: StateTreeNode[];
};

export const archiveManifestSchema = v.object({
  state: v.object({
    name: v.string(),
    notes: v.nullable(v.string()),
    tags: v.array(v.string()),
    created_at: timestampSchema,
  }),
  adapters: v.array(
    v.object({
      archive_adapter_id: v.string(),
      adapter_name: v.string(),
      engine: v.string(),
      engine_version: v.string(),
      tables: v.number(),
      row_count: v.number(),
      byte_count: v.number(),
    })
  ),
});

export type ArchiveManifest = v.InferOutput<typeof archiveManifestSchema>;

export const importArchiveSchema = v.object({
  upload_id: idSchema,
  name: stateNameSchema,
  adapter_mapping: v.array(
    v.object({
      archive_adapter_id: v.string(),
      target: v.union([
        v.object({ adapter_id: idSchema }),
        v.object({ create: adapterDraftSchema }),
      ]),
    })
  ),
});

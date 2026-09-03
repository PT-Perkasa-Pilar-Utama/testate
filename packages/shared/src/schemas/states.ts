import * as v from "valibot";

import { stateKindSchema, stateStatusSchema } from "../enums.ts";
import { actorSchema, engineWarningSchema, idSchema, timestampSchema } from "./common.ts";
import { adapterDraftSchema } from "./adapters.ts";

const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const stateNameSchema = v.pipe(
  v.string(),
  v.minLength(1, "Enter a name."),
  v.maxLength(80, "A name is at most 80 characters."),
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

/**
 * A state in the list, with what it produced.
 *
 * The hierarchy as data rather than as navigation: a checkout and a diff are events that reference
 * a state, so the state can say how many of each it has. Two grouped
 * counts folded into the same response, not a second round trip.
 */
export const stateListItemSchema = v.object({
  ...stateSchema.entries,
  checkout_count: v.number(),
  diff_count: v.number(),
});
export type StateListItem = v.InferOutput<typeof stateListItemSchema>;

/**
 * A table against the parent state's manifest: the same blob, a different one, or new. Null when
 * the state has no parent to compare with. A table the parent had and this state lacks is named
 * in the adapter's `removed_tables`.
 */
export const tableChangeSchema = v.picklist(["same", "changed", "added"]);
export type TableChange = v.InferOutput<typeof tableChangeSchema>;
export const detailTableSchema = v.object({
  ...manifestTableSchema.entries,
  change: v.nullable(tableChangeSchema),
});
export type DetailTable = v.InferOutput<typeof detailTableSchema>;

export const stateDetailSchema = v.object({
  ...stateListItemSchema.entries,
  /** When the newest checkout of this state was asked for; null when there was none. */
  last_checkout_at: v.nullable(timestampSchema),
  adapters: v.array(
    v.object({
      ...stateAdapterSchema.entries,
      tables: v.array(detailTableSchema),
      removed_tables: v.array(v.string()),
    })
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

/**
 * The take/edit dialogs (Formisch, see the `formisch-forms` skill): tags as the comma-separated
 * text a person types rather than the array `createStateSchema`/`updateStateSchema` send, and
 * `adapter_ids` present on both so one schema serves both dialogs - edit just never renders it.
 */
export const stateDraftSchema = v.object({
  name: stateNameSchema,
  notes: v.pipe(v.string(), v.maxLength(4000, "Notes are at most 4000 characters.")),
  tags: v.string(),
  adapter_ids: v.array(idSchema),
});
export type StateDraftInput = v.InferOutput<typeof stateDraftSchema>;

/** The delete-state dialog confirms with a button, not a field; Formisch still needs a schema. */
export const deleteStateFormSchema = v.object({});

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

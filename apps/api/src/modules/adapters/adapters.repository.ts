import type {
  Adapter,
  AdapterMode,
  Capabilities,
  JsonObject,
  RestoreStrategy,
} from "@testate/shared";
import {
  adapterKindSchema,
  adapterModeSchema,
  adapterStatusSchema,
  capabilitiesSchema,
  engineSchema,
  jsonObjectSchema,
  readOnlyEnforcementSchema,
  restoreStrategySchema,
} from "@testate/shared";
import * as v from "valibot";

import type { MetadataDb } from "../../lib/db/index.ts";
import { isSealed, kidOfSealed } from "../../lib/sealed/index.ts";
import type { Sealed } from "../../lib/sealed/index.ts";

const recordSchema = v.object({
  id: v.string(),
  project_id: v.string(),
  kind: adapterKindSchema,
  engine: engineSchema,
  name: v.string(),
  mode: adapterModeSchema,
  config_public: v.string(),
  config_sealed: v.string(),
  readonly_config_sealed: v.nullable(v.string()),
  excluded_tables: v.string(),
  restore_mode: v.picklist(["atomic", "fast"]),
  lock_timeout_ms: v.number(),
  target_hash: v.nullable(v.string()),
  status: adapterStatusSchema,
  status_message: v.nullable(v.string()),
  engine_version: v.nullable(v.string()),
  dialect: v.nullable(v.string()),
  capabilities: v.nullable(v.string()),
  strategy: v.nullable(v.string()),
  read_only_enforcement: v.nullable(readOnlyEnforcementSchema),
  sealed_set_at: v.nullable(v.string()),
  sealed_key_fingerprint: v.nullable(v.string()),
  last_probe_at: v.nullable(v.string()),
  created_at: v.string(),
  updated_at: v.string(),
});
type AdapterRow = v.InferOutput<typeof recordSchema>;

/** The row with its sealed envelopes and target hash; only the adapters module reads it. */
export type AdapterRecord = Adapter & {
  config_sealed: Sealed;
  readonly_config_sealed: Sealed | null;
  target_hash: string | null;
};

export type NewAdapter = {
  id: string;
  project_id: string;
  kind: Adapter["kind"];
  engine: Adapter["engine"];
  name: string;
  mode: AdapterMode;
  config_public: JsonObject;
  config_sealed: Sealed;
  readonly_config_sealed: Sealed | null;
  excluded_tables: string[];
  restore_mode: "atomic" | "fast";
  lock_timeout_ms: number;
  target_hash: string;
  has_secrets: boolean;
  created_at: string;
};

export type AdapterConfigPatch = {
  name?: string;
  config_public?: JsonObject;
  config_sealed?: Sealed;
  readonly_config_sealed?: Sealed | null;
  excluded_tables?: string[];
  restore_mode?: "atomic" | "fast";
  lock_timeout_ms?: number;
  target_hash?: string;
  sealed_set_at?: string;
};

export type ProbeColumns = {
  status: Adapter["status"];
  status_message: string | null;
  engine_version: string | null;
  dialect: string | null;
  capabilities: Capabilities | null;
  strategy: RestoreStrategy | null;
  read_only_enforcement: Adapter["read_only_enforcement"];
  last_probe_at: string;
};

export type AdaptersFilter = {
  kind?: Adapter["kind"];
  engine?: Adapter["engine"];
  status?: Adapter["status"];
};

/** One adapter that already tracks a target, named the way an operator recognises it. */
export type TargetShare = { project_slug: string; name: string };

const targetShare = v.object({ project_slug: v.string(), name: v.string() });
const SHARING = `SELECT p.slug AS project_slug, a.name FROM adapters a
  JOIN projects p ON p.id = a.project_id WHERE a.target_hash = ? ORDER BY p.slug, a.name`;

export type AdaptersRepository = {
  list(projectId: string, filter: AdaptersFilter): AdapterRecord[];
  /** Every adapter of every project, for instance-wide policy rechecks (16 §16.2). */
  all(): AdapterRecord[];
  byId(id: string): AdapterRecord | null;
  byName(projectId: string, name: string): AdapterRecord | null;
  /** Adapters anywhere that already point at this target; two testers on one database collide. */
  sharingTarget(targetHash: string): TargetShare[];
  insert(adapter: NewAdapter): AdapterRecord;
  updateConfig(id: string, patch: AdapterConfigPatch, at: string): void;
  setMode(id: string, mode: AdapterMode, at: string): void;
  setProbe(id: string, probe: ProbeColumns, at: string): void;
  setStatus(id: string, status: Adapter["status"], message: string | null, at: string): void;
  remove(id: string): void;
  statesReferencing(id: string): number;
  endWriteSessions(id: string, at: string): number;
};

function sealedOf(value: string): Sealed {
  if (!isSealed(value)) throw new Error("adapter row holds a malformed sealed value");
  // SAFETY: isSealed validated the envelope on the line above.
  return value as Sealed;
}

function credentialOf(sealed: string | null, setAt: string | null): Adapter["credential"] {
  if (sealed === null || setAt === null) return { set: false };
  return { set: true, set_at: setAt, key_fingerprint: kidOfSealed(sealedOf(sealed)) };
}

function toRecord(row: AdapterRow): AdapterRecord {
  return {
    id: row.id,
    project_id: row.project_id,
    kind: row.kind,
    engine: row.engine,
    tier: TIER_BY_ENGINE[row.engine],
    name: row.name,
    mode: row.mode,
    status: row.status,
    status_message: row.status_message,
    config: v.parse(jsonObjectSchema, JSON.parse(row.config_public)),
    credential: credentialOf(row.config_sealed, row.sealed_set_at),
    readonly_credential: credentialOf(row.readonly_config_sealed, row.sealed_set_at),
    excluded_tables: v.parse(v.array(v.string()), JSON.parse(row.excluded_tables)),
    restore_mode: row.restore_mode,
    lock_timeout_ms: row.lock_timeout_ms,
    engine_version: row.engine_version,
    dialect: row.dialect,
    capabilities:
      row.capabilities === null ? null : v.parse(capabilitiesSchema, JSON.parse(row.capabilities)),
    strategy:
      row.strategy === null ? null : v.parse(restoreStrategySchema, JSON.parse(row.strategy)),
    read_only_enforcement: row.read_only_enforcement,
    last_probe_at: row.last_probe_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    config_sealed: sealedOf(row.config_sealed),
    readonly_config_sealed:
      row.readonly_config_sealed === null ? null : sealedOf(row.readonly_config_sealed),
    target_hash: row.target_hash,
  };
}

const TIER_BY_ENGINE = {
  postgres: "tabular",
  mysql: "tabular",
  mariadb: "tabular",
  mongodb: "document",
  s3: "files",
  sftp: "files",
  ftp: "files",
  http: "files",
} as const satisfies Record<AdapterRow["engine"], Adapter["tier"]>;

type Column = [string, string | number | null];

function patchColumns(patch: AdapterConfigPatch): Column[] {
  const columns: Column[] = [];
  if (patch.name !== undefined) columns.push(["name", patch.name]);
  if (patch.config_public !== undefined)
    columns.push(["config_public", JSON.stringify(patch.config_public)]);
  if (patch.config_sealed !== undefined) columns.push(["config_sealed", patch.config_sealed]);
  if (patch.readonly_config_sealed !== undefined)
    columns.push(["readonly_config_sealed", patch.readonly_config_sealed]);
  if (patch.excluded_tables !== undefined)
    columns.push(["excluded_tables", JSON.stringify(patch.excluded_tables)]);
  if (patch.restore_mode !== undefined) columns.push(["restore_mode", patch.restore_mode]);
  if (patch.lock_timeout_ms !== undefined) columns.push(["lock_timeout_ms", patch.lock_timeout_ms]);
  if (patch.target_hash !== undefined) columns.push(["target_hash", patch.target_hash]);
  if (patch.sealed_set_at !== undefined) columns.push(["sealed_set_at", patch.sealed_set_at]);
  return columns;
}

export function createAdaptersRepository(db: MetadataDb): AdaptersRepository {
  const one = (where: string, ...params: string[]): AdapterRecord | null => {
    const row = db.query(`SELECT * FROM adapters WHERE ${where}`).get(...params);
    return row === null ? null : toRecord(v.parse(recordSchema, row));
  };
  const count = (sql: string, ...params: string[]): number =>
    v.parse(v.object({ n: v.number() }), db.query(sql).get(...params)).n;
  const set = (id: string, columns: Column[], at: string): void => {
    const all: Column[] = [...columns, ["updated_at", at]];
    db.query(
      `UPDATE adapters SET ${all.map(([name]) => `${name} = ?`).join(", ")} WHERE id = ?`
    ).run(...all.map(([, value]) => value), id);
  };
  return {
    list(projectId, filter) {
      const conditions = ["project_id = ?"];
      const params = [projectId];
      for (const key of ["kind", "engine", "status"] as const) {
        const value = filter[key];
        if (value === undefined) continue;
        conditions.push(`${key} = ?`);
        params.push(value);
      }
      const rows = db
        .query(
          `SELECT * FROM adapters WHERE ${conditions.join(" AND ")} ORDER BY name COLLATE NOCASE ASC, id ASC`
        )
        .all(...params);
      return v.parse(v.array(recordSchema), rows).map(toRecord);
    },
    all: () =>
      v
        .parse(v.array(recordSchema), db.query("SELECT * FROM adapters ORDER BY id").all())
        .map(toRecord),
    byId: (id) => one("id = ?", id),
    byName: (projectId, name) => one("project_id = ? AND name = ?", projectId, name),
    sharingTarget: (targetHash) => v.parse(v.array(targetShare), db.query(SHARING).all(targetHash)),
    insert(adapter) {
      db.query(
        `INSERT INTO adapters (id, project_id, kind, engine, name, mode, config_public, config_sealed,
           readonly_config_sealed, excluded_tables, restore_mode, lock_timeout_ms, target_hash,
           sealed_set_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        adapter.id,
        adapter.project_id,
        adapter.kind,
        adapter.engine,
        adapter.name,
        adapter.mode,
        JSON.stringify(adapter.config_public),
        adapter.config_sealed,
        adapter.readonly_config_sealed,
        JSON.stringify(adapter.excluded_tables),
        adapter.restore_mode,
        adapter.lock_timeout_ms,
        adapter.target_hash,
        adapter.has_secrets ? adapter.created_at : null,
        adapter.created_at,
        adapter.created_at
      );
      const inserted = one("id = ?", adapter.id);
      if (inserted === null) throw new Error("inserted adapter vanished");
      return inserted;
    },
    updateConfig(id, patch, at) {
      set(id, patchColumns(patch), at);
    },
    setMode(id, mode, at) {
      set(id, [["mode", mode]], at);
    },
    setProbe(id, probe, at) {
      set(
        id,
        [
          ["status", probe.status],
          ["status_message", probe.status_message],
          ["engine_version", probe.engine_version],
          ["dialect", probe.dialect],
          ["capabilities", probe.capabilities === null ? null : JSON.stringify(probe.capabilities)],
          ["strategy", probe.strategy === null ? null : JSON.stringify(probe.strategy)],
          ["read_only_enforcement", probe.read_only_enforcement],
          ["last_probe_at", probe.last_probe_at],
        ],
        at
      );
    },
    setStatus(id, status, message, at) {
      set(
        id,
        [
          ["status", status],
          ["status_message", message],
        ],
        at
      );
    },
    remove(id) {
      db.query("DELETE FROM adapters WHERE id = ?").run(id);
    },
    statesReferencing: (id) =>
      count("SELECT COUNT(*) AS n FROM state_adapters WHERE adapter_id = ?", id),
    endWriteSessions(id, at) {
      return db
        .query("UPDATE write_sessions SET ended_at = ? WHERE adapter_id = ? AND ended_at IS NULL")
        .run(at, id).changes;
    },
  };
}

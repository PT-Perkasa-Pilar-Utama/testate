import type { Project } from "@testate/shared";
import { headStatusSchema } from "@testate/shared";
import type { HeadStatus } from "@testate/shared";
import * as v from "valibot";
import { keysetCondition } from "../../lib/db/keyset.ts";
import { likeTerm } from "../../lib/db/like.ts";

import type { MetadataDb } from "../../lib/db/index.ts";

const projectRecordSchema = v.object({
  id: v.string(),
  slug: v.string(),
  name: v.string(),
  description: v.nullable(v.string()),
  quota_bytes: v.nullable(v.number()),
  head_state_id: v.nullable(v.string()),
  head_state_name: v.nullable(v.string()),
  head_status: headStatusSchema,
  head_changed_at: v.nullable(v.string()),
  created_by: v.string(),
  created_at: v.string(),
  updated_at: v.string(),
});
type ProjectRecord = v.InferOutput<typeof projectRecordSchema>;

export type ProjectsListQuery = {
  limit: number;
  sort: "name" | "created_at";
  order: "asc" | "desc";
  q?: string;
  /** Continues after a `next_cursor` from the page before. */
  cursor?: string;
  /** Null means every project; a list restricts to a token's scope (09 §9.5). */
  ids: string[] | null;
};

export type NewProject = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  quota_bytes: number | null;
  created_by: string;
  created_at: string;
};

export type ProjectPatch = {
  name?: string;
  description?: string | null;
  quota_bytes?: number | null;
};

export type ProjectsRepository = {
  list(query: ProjectsListQuery): Project[];
  /** How many rows the filter matches, ignoring the page. */
  total(query: ProjectsListQuery): number;
  bySlug(slug: string): Project | null;
  byId(id: string): Project | null;
  exists(id: string): boolean;
  insert(project: NewProject): Project;
  update(id: string, patch: ProjectPatch, at: string): void;
  /** HEAD moves on snapshot and checkout; `unknown` after a failed restore (05 §5.4). */
  setHead(id: string, stateId: string | null, status: HeadStatus, at: string): void;
  remove(id: string): void;
  usedBytes(projectId: string): number;
  instanceUsedBytes(): number;
  protectedStates(projectId: string): number;
  /** What a deletion takes with the project, for the confirmation dialog (04 §4.8). */
  deletionCounts(projectId: string): DeletionCounts;
};

/** Rows that go with the project: everything cascades from it, tokens are revoked by the job. */
export type DeletionCounts = {
  adapters: number;
  states: number;
  protected_states: number;
  checkouts: number;
  diffs: number;
  import_runs: number;
  saved_queries: number;
  tokens: number;
};

const SELECT = `SELECT p.*, s.name AS head_state_name
  FROM projects p LEFT JOIN states s ON s.id = p.head_state_id`;

const SORT_COLUMNS = { name: "p.name COLLATE NOCASE", created_at: "p.created_at" } as const;

function toProject(row: ProjectRecord): Project {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    quota_bytes: row.quota_bytes,
    head: {
      status: row.head_status,
      state_id: row.head_state_id,
      state_name: row.head_state_name,
      changed_at: row.head_changed_at,
    },
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

type Condition = { sql: string; params: (string | number)[] };

function conditions(query: ProjectsListQuery): Condition[] {
  const found: Condition[] = [];
  if (query.q !== undefined && query.q !== "") {
    const like = likeTerm(query.q);
    found.push({
      sql: "(p.slug LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\')",
      params: [like, like],
    });
  }
  if (query.ids !== null) {
    const marks = query.ids.map(() => "?").join(",");
    found.push({ sql: `p.id IN (${marks === "" ? "NULL" : marks})`, params: query.ids });
  }
  return found;
}

export function createProjectsRepository(db: MetadataDb): ProjectsRepository {
  const countRow = v.object({ n: v.number() });
  const sum = (sql: string, ...params: string[]): number =>
    v.parse(countRow, db.query(sql).get(...params)).n;
  const one = (where: string, param: string): Project | null => {
    const row = db.query(`${SELECT} WHERE ${where}`).get(param);
    return row === null ? null : toProject(v.parse(projectRecordSchema, row));
  };
  return {
    total(query) {
      // The same conditions as `list` without the cursor, which is what makes it a page and not
      // a filter: counting from the cursor would answer "how many are left", not "how many match".
      const found = conditions(query);
      const where =
        found.length === 0 ? "" : ` WHERE ${found.map((item) => item.sql).join(" AND ")}`;
      const row = db
        .query(`SELECT COUNT(*) AS n FROM projects p${where}`)
        .get(...found.flatMap((item) => item.params));
      return v.parse(countRow, row).n;
    },
    list(query) {
      const found = conditions(query);
      const after = keysetCondition(
        {
          column: SORT_COLUMNS[query.sort],
          id: "p.id",
          sort: query.sort,
          order: query.order,
          idOrder: "asc",
        },
        query.cursor
      );
      if (after !== null) found.push(after);
      const where =
        found.length === 0 ? "" : ` WHERE ${found.map((item) => item.sql).join(" AND ")}`;
      const order = `${SORT_COLUMNS[query.sort]} ${query.order === "desc" ? "DESC" : "ASC"}, p.id ASC`;
      const rows = db
        .query(`${SELECT}${where} ORDER BY ${order} LIMIT ?`)
        .all(...found.flatMap((item) => item.params), query.limit);
      return v.parse(v.array(projectRecordSchema), rows).map(toProject);
    },
    bySlug: (slug) => one("p.slug = ?", slug),
    byId: (id) => one("p.id = ?", id),
    exists: (id) => db.query("SELECT 1 FROM projects WHERE id = ?").get(id) !== null,
    insert(project) {
      db.query(
        `INSERT INTO projects (id, slug, name, description, quota_bytes, head_state_id, head_status,
           head_changed_at, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, 'none', NULL, ?, ?, ?)`
      ).run(
        project.id,
        project.slug,
        project.name,
        project.description,
        project.quota_bytes,
        project.created_by,
        project.created_at,
        project.created_at
      );
      const inserted = one("p.id = ?", project.id);
      if (inserted === null) throw new Error("inserted project vanished");
      return inserted;
    },
    update(id, patch, at) {
      const sets: string[] = ["updated_at = ?"];
      const params: (string | number | null)[] = [at];
      if (patch.name !== undefined) {
        sets.push("name = ?");
        params.push(patch.name);
      }
      if (patch.description !== undefined) {
        sets.push("description = ?");
        params.push(patch.description);
      }
      if (patch.quota_bytes !== undefined) {
        sets.push("quota_bytes = ?");
        params.push(patch.quota_bytes);
      }
      db.query(`UPDATE projects SET ${sets.join(", ")} WHERE id = ?`).run(...params, id);
    },
    setHead(id, stateId, status, at) {
      db.query(
        "UPDATE projects SET head_state_id = ?, head_status = ?, head_changed_at = ?, updated_at = ? WHERE id = ?"
      ).run(stateId, status, at, at, id);
    },
    remove(id) {
      db.query("DELETE FROM projects WHERE id = ?").run(id);
    },
    usedBytes: (projectId) =>
      sum("SELECT COALESCE(SUM(size_bytes), 0) AS n FROM states WHERE project_id = ?", projectId),
    instanceUsedBytes: () => sum("SELECT COALESCE(SUM(size_bytes), 0) AS n FROM states"),
    protectedStates: (projectId) =>
      sum("SELECT COUNT(*) AS n FROM states WHERE project_id = ? AND protected = 1", projectId),
    deletionCounts: (projectId) => ({
      adapters: sum("SELECT COUNT(*) AS n FROM adapters WHERE project_id = ?", projectId),
      states: sum("SELECT COUNT(*) AS n FROM states WHERE project_id = ?", projectId),
      protected_states: sum(
        "SELECT COUNT(*) AS n FROM states WHERE project_id = ? AND protected = 1",
        projectId
      ),
      checkouts: sum("SELECT COUNT(*) AS n FROM checkouts WHERE project_id = ?", projectId),
      diffs: sum("SELECT COUNT(*) AS n FROM diffs WHERE project_id = ?", projectId),
      import_runs: sum("SELECT COUNT(*) AS n FROM import_runs WHERE project_id = ?", projectId),
      saved_queries: sum(
        `SELECT COUNT(*) AS n FROM saved_queries q
           JOIN adapters a ON a.id = q.adapter_id WHERE a.project_id = ?`,
        projectId
      ),
      tokens: sum(
        "SELECT COUNT(*) AS n FROM api_tokens WHERE revoked_at IS NULL AND project_ids LIKE ?",
        `%"${projectId}"%`
      ),
    }),
  };
}

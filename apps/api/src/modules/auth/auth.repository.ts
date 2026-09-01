import type { ApiToken, Role } from "@testate/shared";
import { idSchema, roleSchema, tokenKindSchema } from "@testate/shared";
import * as v from "valibot";
import { keysetCondition } from "../../lib/db/keyset.ts";
import { likeTerm } from "../../lib/db/like.ts";

import type { MetadataDb } from "../../lib/db/index.ts";

const sessionRecordSchema = v.object({
  id: v.string(),
  user_id: v.string(),
  token_hash: v.string(),
  ip: v.nullable(v.string()),
  user_agent: v.nullable(v.string()),
  last_seen_at: v.string(),
  expires_at: v.string(),
  created_at: v.string(),
});
export type SessionRecord = v.InferOutput<typeof sessionRecordSchema>;

const tokenRecordSchema = v.object({
  id: v.string(),
  name: v.string(),
  role: roleSchema,
  kind: tokenKindSchema,
  project_ids: v.nullable(v.string()),
  token_hash: v.string(),
  prefix: v.string(),
  created_by: v.nullable(v.string()),
  last_used_at: v.nullable(v.string()),
  expires_at: v.nullable(v.string()),
  revoked_at: v.nullable(v.string()),
  created_at: v.string(),
});
type TokenRecordRow = v.InferOutput<typeof tokenRecordSchema>;

/** A token row with its parsed scope; the hash never leaves the repository. */
export type TokenRecord = ApiToken;

export type NewSession = {
  id: string;
  user_id: string;
  token_hash: string;
  ip: string | null;
  user_agent: string | null;
  last_seen_at: string;
  expires_at: string;
  created_at: string;
};

export type NewToken = {
  id: string;
  name: string;
  role: Role;
  kind: ApiToken["kind"];
  project_ids: string[] | null;
  token_hash: string;
  prefix: string;
  created_by: string | null;
  expires_at: string | null;
  created_at: string;
};

export type TokenSort = "name" | "created_at" | "last_used_at" | "expires_at";

export type TokensListQuery = {
  kind?: ApiToken["kind"];
  revoked?: boolean;
  limit?: number;
  sort: TokenSort;
  order: "asc" | "desc";
  q?: string;
  cursor?: string;
};

/** Only these, and only through the map: a sort arriving as text never reaches the SQL. */
const TOKEN_SORT_COLUMNS = {
  name: "name COLLATE NOCASE",
  created_at: "created_at",
  last_used_at: "last_used_at",
  expires_at: "expires_at",
} as const satisfies Record<TokenSort, string>;

function tokenConditions(query: TokensListQuery): { sql: string; params: (string | number)[] }[] {
  const found: { sql: string; params: (string | number)[] }[] = [];
  if (query.kind !== undefined) found.push({ sql: "kind = ?", params: [query.kind] });
  if (query.revoked === true) found.push({ sql: "revoked_at IS NOT NULL", params: [] });
  if (query.revoked === false) found.push({ sql: "revoked_at IS NULL", params: [] });
  if (query.q !== undefined && query.q !== "") {
    const like = likeTerm(query.q);
    found.push({
      sql: "(name LIKE ? ESCAPE '\\' OR prefix LIKE ? ESCAPE '\\')",
      params: [like, like],
    });
  }
  return found;
}

export type AuthRepository = {
  insertSession(session: NewSession): void;
  sessionByHash(hash: string): SessionRecord | null;
  sessionById(id: string): SessionRecord | null;
  touchSession(id: string, lastSeenAt: string, expiresAt: string): void;
  deleteSession(id: string): void;
  deleteUserSessions(userId: string, exceptId?: string): number;
  listSessions(userId: string): SessionRecord[];
  insertToken(token: NewToken): TokenRecord;
  tokenByHash(hash: string): TokenRecord | null;
  tokenById(id: string): TokenRecord | null;
  listTokens(query: TokensListQuery): TokenRecord[];
  /** How many tokens the filter matches, ignoring the page. */
  totalTokens(query: TokensListQuery): number;
  touchToken(id: string, at: string): void;
  revokeToken(id: string, at: string): void;
};

const projectIdsSchema = v.array(idSchema);

function toToken(row: TokenRecordRow): TokenRecord {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    role: row.role,
    project_ids:
      row.project_ids === null ? null : v.parse(projectIdsSchema, JSON.parse(row.project_ids)),
    prefix: row.prefix,
    created_by: row.created_by,
    created_at: row.created_at,
    last_used_at: row.last_used_at,
    expires_at: row.expires_at,
    revoked_at: row.revoked_at,
  };
}

export function createAuthRepository(db: MetadataDb): AuthRepository {
  const oneSession = (sql: string, param: string): SessionRecord | null => {
    const row = db.query(sql).get(param);
    return row === null ? null : v.parse(sessionRecordSchema, row);
  };
  const oneToken = (sql: string, param: string): TokenRecord | null => {
    const row = db.query(sql).get(param);
    return row === null ? null : toToken(v.parse(tokenRecordSchema, row));
  };
  return {
    insertSession(session) {
      db.query(
        `INSERT INTO sessions (id, user_id, token_hash, ip, user_agent, last_seen_at, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        session.id,
        session.user_id,
        session.token_hash,
        session.ip,
        session.user_agent,
        session.last_seen_at,
        session.expires_at,
        session.created_at
      );
    },
    sessionByHash: (hash) => oneSession("SELECT * FROM sessions WHERE token_hash = ?", hash),
    sessionById: (id) => oneSession("SELECT * FROM sessions WHERE id = ?", id),
    touchSession(id, lastSeenAt, expiresAt) {
      db.query("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?").run(
        lastSeenAt,
        expiresAt,
        id
      );
    },
    deleteSession(id) {
      db.query("DELETE FROM sessions WHERE id = ?").run(id);
    },
    deleteUserSessions(userId, exceptId) {
      const result =
        exceptId === undefined
          ? db.query("DELETE FROM sessions WHERE user_id = ?").run(userId)
          : db.query("DELETE FROM sessions WHERE user_id = ? AND id <> ?").run(userId, exceptId);
      return result.changes;
    },
    listSessions(userId) {
      const rows = db
        .query("SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC")
        .all(userId);
      return v.parse(v.array(sessionRecordSchema), rows);
    },
    insertToken(token) {
      db.query(
        `INSERT INTO api_tokens (id, name, role, kind, project_ids, token_hash, prefix, created_by,
           last_used_at, expires_at, revoked_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?)`
      ).run(
        token.id,
        token.name,
        token.role,
        token.kind,
        token.project_ids === null ? null : JSON.stringify(token.project_ids),
        token.token_hash,
        token.prefix,
        token.created_by,
        token.expires_at,
        token.created_at
      );
      const inserted = oneToken("SELECT * FROM api_tokens WHERE id = ?", token.id);
      if (inserted === null) throw new Error("inserted token vanished");
      return inserted;
    },
    tokenByHash: (hash) => oneToken("SELECT * FROM api_tokens WHERE token_hash = ?", hash),
    tokenById: (id) => oneToken("SELECT * FROM api_tokens WHERE id = ?", id),
    totalTokens(query) {
      // The same conditions as `listTokens` without the cursor: counting from the cursor would
      // answer "how many are left", not "how many match".
      const found = tokenConditions(query);
      const where =
        found.length === 0 ? "" : ` WHERE ${found.map((item) => item.sql).join(" AND ")}`;
      const row = db
        .query(`SELECT COUNT(*) AS n FROM api_tokens${where}`)
        .get(...found.flatMap((item) => item.params));
      return v.parse(v.object({ n: v.number() }), row).n;
    },
    listTokens(query) {
      const found = tokenConditions(query);
      const column = TOKEN_SORT_COLUMNS[query.sort];
      const direction = query.order === "desc" ? "DESC" : "ASC";
      const after = keysetCondition(
        { column, id: "id", sort: query.sort, order: query.order, idOrder: "asc" },
        query.cursor
      );
      if (after !== null) found.push(after);
      const where =
        found.length === 0 ? "" : ` WHERE ${found.map((item) => item.sql).join(" AND ")}`;
      const rows = db
        .query(`SELECT * FROM api_tokens${where} ORDER BY ${column} ${direction}, id ASC LIMIT ?`)
        .all(...found.flatMap((item) => item.params), query.limit ?? 200);
      return v.parse(v.array(tokenRecordSchema), rows).map(toToken);
    },
    touchToken(id, at) {
      db.query("UPDATE api_tokens SET last_used_at = ? WHERE id = ?").run(at, id);
    },
    revokeToken(id, at) {
      db.query("UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(
        at,
        id
      );
    },
  };
}

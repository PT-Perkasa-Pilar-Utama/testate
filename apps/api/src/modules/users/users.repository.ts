import type { Role, User } from "@testate/shared";
import { roleSchema } from "@testate/shared";
import * as v from "valibot";

import type { MetadataDb } from "../../lib/db/index.ts";

const userRecordSchema = v.object({
  id: v.string(),
  username: v.string(),
  display_name: v.string(),
  role: roleSchema,
  password_hash: v.string(),
  must_change_password: v.number(),
  failed_login_count: v.number(),
  locked_until: v.nullable(v.string()),
  disabled_at: v.nullable(v.string()),
  last_login_at: v.nullable(v.string()),
  created_at: v.string(),
  updated_at: v.string(),
});
type UserRecordRow = v.InferOutput<typeof userRecordSchema>;

/** The row with its secret and counters; only the users and auth modules see it. */
export type UserRecord = User & { password_hash: string; failed_login_count: number };

export type UsersListQuery = {
  limit: number;
  sort: "username" | "created_at" | "last_login_at";
  order: "asc" | "desc";
  role?: Role;
  disabled?: boolean;
  q?: string;
};

export type NewUser = {
  id: string;
  username: string;
  display_name: string;
  role: Role;
  password_hash: string;
  must_change_password: boolean;
  created_at: string;
};

export type UsersRepository = {
  count(): number;
  countEnabledAdmins(): number;
  list(query: UsersListQuery): UserRecord[];
  byId(id: string): UserRecord | null;
  byUsername(username: string): UserRecord | null;
  insert(user: NewUser): UserRecord;
  setProfile(id: string, displayName: string | undefined, role: Role | undefined, at: string): void;
  setPassword(id: string, hash: string, mustChange: boolean, at: string): void;
  setDisabled(id: string, disabledAt: string | null, at: string): void;
  recordFailure(id: string, count: number, lockedUntil: string | null, at: string): void;
  recordLogin(id: string, at: string): void;
  remove(id: string): void;
};

function toRecord(row: UserRecordRow): UserRecord {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    role: row.role,
    must_change_password: row.must_change_password === 1,
    disabled_at: row.disabled_at,
    locked_until: row.locked_until,
    last_login_at: row.last_login_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    password_hash: row.password_hash,
    failed_login_count: row.failed_login_count,
  };
}

export function toUser(record: UserRecord): User {
  return {
    id: record.id,
    username: record.username,
    display_name: record.display_name,
    role: record.role,
    must_change_password: record.must_change_password,
    disabled_at: record.disabled_at,
    locked_until: record.locked_until,
    last_login_at: record.last_login_at,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

const SORT_COLUMNS = {
  username: "username COLLATE NOCASE",
  created_at: "created_at",
  last_login_at: "last_login_at",
} as const;

type Condition = { sql: string; params: string[] };

function conditions(query: UsersListQuery): Condition[] {
  const found: Condition[] = [];
  if (query.role !== undefined) found.push({ sql: "role = ?", params: [query.role] });
  if (query.disabled === true) found.push({ sql: "disabled_at IS NOT NULL", params: [] });
  if (query.disabled === false) found.push({ sql: "disabled_at IS NULL", params: [] });
  if (query.q !== undefined && query.q !== "") {
    const like = `%${query.q}%`;
    found.push({ sql: "(username LIKE ? OR display_name LIKE ?)", params: [like, like] });
  }
  return found;
}

export function createUsersRepository(db: MetadataDb): UsersRepository {
  const one = (sql: string, ...params: string[]): UserRecord | null => {
    const row = db.query(sql).get(...params);
    return row === null ? null : toRecord(v.parse(userRecordSchema, row));
  };
  const countRow = v.object({ n: v.number() });
  const count = (sql: string): number => v.parse(countRow, db.query(sql).get()).n;
  return {
    count: () => count("SELECT COUNT(*) AS n FROM users"),
    countEnabledAdmins: () =>
      count("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled_at IS NULL"),
    list(query) {
      const found = conditions(query);
      const where =
        found.length === 0 ? "" : ` WHERE ${found.map((item) => item.sql).join(" AND ")}`;
      const order = `${SORT_COLUMNS[query.sort]} ${query.order === "desc" ? "DESC" : "ASC"}, id ASC`;
      // ponytail: no cursor — ceiling ~200 accounts per instance; add a keyset when one passes it.
      const rows = db
        .query(`SELECT * FROM users${where} ORDER BY ${order} LIMIT ?`)
        .all(...found.flatMap((item) => item.params), query.limit);
      return v.parse(v.array(userRecordSchema), rows).map(toRecord);
    },
    byId: (id) => one("SELECT * FROM users WHERE id = ?", id),
    byUsername: (username) => one("SELECT * FROM users WHERE username = ?", username),
    insert(user) {
      db.query(
        `INSERT INTO users (id, username, display_name, role, password_hash, must_change_password,
           failed_login_count, locked_until, disabled_at, last_login_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, ?, ?)`
      ).run(
        user.id,
        user.username,
        user.display_name,
        user.role,
        user.password_hash,
        user.must_change_password ? 1 : 0,
        user.created_at,
        user.created_at
      );
      const inserted = one("SELECT * FROM users WHERE id = ?", user.id);
      if (inserted === null) throw new Error("inserted user vanished");
      return inserted;
    },
    setProfile(id, displayName, role, at) {
      db.query(
        "UPDATE users SET display_name = COALESCE(?, display_name), role = COALESCE(?, role), updated_at = ? WHERE id = ?"
      ).run(displayName ?? null, role ?? null, at, id);
    },
    setPassword(id, hash, mustChange, at) {
      db.query(
        `UPDATE users SET password_hash = ?, must_change_password = ?, failed_login_count = 0,
           locked_until = NULL, updated_at = ? WHERE id = ?`
      ).run(hash, mustChange ? 1 : 0, at, id);
    },
    setDisabled(id, disabledAt, at) {
      db.query("UPDATE users SET disabled_at = ?, updated_at = ? WHERE id = ?").run(
        disabledAt,
        at,
        id
      );
    },
    recordFailure(id, failedCount, lockedUntil, at) {
      db.query(
        "UPDATE users SET failed_login_count = ?, locked_until = ?, updated_at = ? WHERE id = ?"
      ).run(failedCount, lockedUntil, at, id);
    },
    recordLogin(id, at) {
      db.query(
        `UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = ?, updated_at = ?
         WHERE id = ?`
      ).run(at, at, id);
    },
    remove(id) {
      db.query("DELETE FROM users WHERE id = ?").run(id);
    },
  };
}

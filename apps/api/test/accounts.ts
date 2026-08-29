import type { Actor, Role } from "@testate/shared";

import { createAuditRepository } from "../src/modules/audit/audit.repository.ts";
import { createAuditService } from "../src/modules/audit/audit.service.ts";
import type { AuditService } from "../src/modules/audit/audit.service.ts";
import { createAuthRepository } from "../src/modules/auth/auth.repository.ts";
import { createAuthService } from "../src/modules/auth/auth.service.ts";
import type { AuthService } from "../src/modules/auth/auth.service.ts";
import { createProjectsRepository } from "../src/modules/projects/projects.repository.ts";
import type { ProjectsRepository } from "../src/modules/projects/projects.repository.ts";
import { createUsersRepository } from "../src/modules/users/users.repository.ts";
import { createUsersService } from "../src/modules/users/users.service.ts";
import type { UsersService } from "../src/modules/users/users.service.ts";
import type { MetadataDb } from "../src/lib/db/index.ts";
import { TEST_HASHER, createClock, createTestDb } from "./db.ts";

export const TEST_META = { ip: "10.0.0.1", user_agent: "test" };
export const ADMIN_PASSWORD = "bootstrap-admin-secret";

export type AccountsHarness = {
  users: UsersService;
  auth: AuthService;
  audit: AuditService;
  admin: Actor;
  advance: (ms: number) => void;
  db: MetadataDb;
  now: () => Date;
  projectsRepo: ProjectsRepository;
};

export function actorOf(user: { id: string; username: string; role: Role }): Actor {
  return { kind: "user", id: user.id, label: user.username, role: user.role, agent: false };
}

/** Real users, auth, and audit services on a fresh in-memory database with one bootstrapped admin. */
export async function createAccounts(): Promise<AccountsHarness> {
  const db = createTestDb();
  const clock = createClock();
  const audit = createAuditService({ repo: createAuditRepository(db), now: clock.now });
  const usersRepo = createUsersRepository(db);
  const authRepo = createAuthRepository(db);
  const projectsRepo = createProjectsRepository(db);
  const users = createUsersService({
    repo: usersRepo,
    sessions: { revokeAll: (id) => authRepo.deleteUserSessions(id) },
    audit,
    password: TEST_HASHER,
    now: clock.now,
  });
  const auth = createAuthService({
    users: usersRepo,
    repo: authRepo,
    audit,
    password: TEST_HASHER,
    now: clock.now,
    projectExists: (id) => projectsRepo.exists(id),
  });
  await users.bootstrap("admin", ADMIN_PASSWORD);
  const [admin] = await users.list({ limit: 1, sort: "username", order: "asc" });
  if (admin === undefined) throw new Error("bootstrap failed");
  return {
    users,
    auth,
    audit,
    admin: actorOf(admin),
    advance: clock.advance,
    db,
    now: clock.now,
    projectsRepo,
  };
}

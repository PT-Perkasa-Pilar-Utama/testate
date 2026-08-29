import type { KeyRing } from "../src/lib/sealed/index.ts";
import type { AdaptersRepository } from "../src/modules/adapters/adapters.repository.ts";
import { createHooksRepository } from "../src/modules/hooks/hooks.repository.ts";
import { createHooksService } from "../src/modules/hooks/hooks.service.ts";
import type { HooksService } from "../src/modules/hooks/hooks.service.ts";
import { createRestRepository } from "../src/modules/rest/rest.repository.ts";
import type { RestRepository } from "../src/modules/rest/rest.repository.ts";
import { createRestService } from "../src/modules/rest/rest.service.ts";
import type { RestService } from "../src/modules/rest/rest.service.ts";
import type { Netguard } from "../src/lib/engines/postgres/pool.ts";
import type { AccountsHarness } from "./accounts.ts";

export type TestIntegrations = { requests: RestRepository; rest: RestService; hooks: HooksService };

/** REST requests and hooks over the accounts harness and the given netguard. */
export function createTestIntegrations(
  accounts: AccountsHarness,
  adapters: AdaptersRepository,
  ring: KeyRing,
  netguard: Netguard
): TestIntegrations {
  const requests = createRestRepository(accounts.db);
  const rest = createRestService({
    repo: requests,
    adapters,
    projects: accounts.projectsRepo,
    ring,
    netguard,
    now: accounts.now,
    bodyCapBytes: 64,
  });
  const hooks = createHooksService({
    repo: createHooksRepository(accounts.db),
    rest,
    requests,
    adapters,
    projects: accounts.projectsRepo,
    audit: accounts.audit,
    now: accounts.now,
  });
  return { requests, rest, hooks };
}

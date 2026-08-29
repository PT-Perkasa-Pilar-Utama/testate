import type { Check, Verdict } from "../../lib/netguard/index.ts";
import type { KeyRing } from "../../lib/sealed/index.ts";
import { validateConfig } from "./adapters.config.ts";
import { purposeOf } from "./adapters.helpers.ts";
import type { AdaptersRepository } from "./adapters.repository.ts";
import { CONFIG_COLUMN, openSecrets } from "./adapters.secrets.ts";

export type PolicyDeps = {
  repo: Pick<AdaptersRepository, "all" | "setStatus">;
  ring: KeyRing;
  netguard: { check(input: Check): Promise<Verdict> };
  now: () => Date;
};

/** Disables every adapter whose target the deny list now blocks; returns their ids (16 §16.2). */
export async function recheckDenyList(deps: PolicyDeps): Promise<string[]> {
  const disabled: string[] = [];
  for (const adapter of deps.repo.all()) {
    const secrets = await openSecrets(deps.ring, adapter.id, CONFIG_COLUMN, adapter.config_sealed);
    const validated = validateConfig(adapter.engine, adapter.kind, adapter.config, secrets);
    const verdict = await deps.netguard.check({
      ...validated.target,
      purpose: purposeOf(validated.kind),
    });
    if (verdict.allowed || adapter.status === "disabled") continue;
    deps.repo.setStatus(adapter.id, "disabled", "policy", deps.now().toISOString());
    disabled.push(adapter.id);
  }
  return disabled;
}

/**
 * A checked command channel for a `journald` adapter (#86; J1 of
 * docs/decisions/2026-10-10-journald.md): the address check, the opened secrets and the host-key
 * trust the files resolver applies, then an SSH shell instead of an SFTP source.
 */
import type { EngineWarning, FileProbeResult, JournaldConfig, JsonObject } from "@testate/shared";
import { journaldConfigSchema } from "@testate/shared";
import * as v from "valibot";

import { AppError } from "../../lib/http/index.ts";
import { journalCommand } from "../../lib/logs/journald/command.ts";
import type { Shell, ShellResult } from "../../lib/logs/journald/read.ts";
import type { CheckedTarget } from "../../lib/netguard/index.ts";
import type { SshShellConfig } from "../../lib/logs/journald/shell.ts";
import { validateConfig } from "./adapters.config.ts";
import { hostKeyTrust, requireStorage } from "./adapters.files.ts";
import type { FilesResolverDeps } from "./adapters.files.ts";
import { refusal } from "./adapters.helpers.ts";
import type { AdapterRecord } from "./adapters.repository.ts";
import { CONFIG_COLUMN, openSecrets } from "./adapters.secrets.ts";
import type { Secrets } from "./adapters.secrets.ts";

export type OpenShell = (config: SshShellConfig) => Shell;

export type ShellResolverDeps = Pick<
  FilesResolverDeps,
  "repo" | "hostKeys" | "ring" | "netguard" | "now"
> & {
  openShell: OpenShell;
};

export type ResolvedShell = { adapter: AdapterRecord; config: JournaldConfig; shell: Shell };

export type ShellResolver = {
  /** `trustAs` may trust a first-seen host key; a token passes null and is refused one. */
  resolve(projectId: string, adapterId: string, trustAs: string | null): Promise<ResolvedShell>;
};

/** The SSH login from an adapter's config and secrets, as an SFTP adapter's. */
export function sshConfigOf(
  config: JournaldConfig,
  secrets: Secrets,
  verifyHostKey: SshShellConfig["verifyHostKey"]
): SshShellConfig {
  const ssh: SshShellConfig = {
    host: config.host,
    port: config.port ?? 22,
    user: config.user,
    verifyHostKey,
  };
  if (secrets["password"] !== undefined) ssh.password = secrets["password"];
  if (secrets["private_key"] !== undefined) ssh.privateKey = secrets["private_key"];
  if (secrets["passphrase"] !== undefined) ssh.passphrase = secrets["passphrase"];
  return ssh;
}

/** A token's refusal of a first-seen key reads as that, not as a changed key. */
function untrustedAware(shell: Shell, untrusted: () => boolean): Shell {
  return {
    async run(command, capBytes) {
      try {
        return await shell.run(command, capBytes);
      } catch (cause: unknown) {
        if (untrusted() && cause instanceof AppError && cause.code === "CONFLICT")
          throw new AppError(
            "CONFLICT",
            "the SSH host key is not trusted yet: a user must read first",
            {
              reason: "host_key_untrusted",
            }
          );
        throw cause;
      }
    },
    close: () => shell.close(),
  };
}

export function createShellResolver(deps: ShellResolverDeps): ShellResolver {
  return {
    async resolve(projectId, adapterId, trustAs) {
      const adapter = requireStorage(deps.repo.byId(adapterId), projectId, "logs");
      if (adapter.engine !== "journald")
        throw new AppError("ENGINE_UNSUPPORTED", "only a journald adapter runs journalctl", {
          reason: "engine",
        });
      const secrets = await openSecrets(
        deps.ring,
        adapter.id,
        CONFIG_COLUMN,
        adapter.config_sealed
      );
      const validated = validateConfig(adapter.engine, adapter.kind, adapter.config, secrets);
      const remote = validated.target;
      if (remote === null) throw new AppError("INTERNAL", "a journald adapter has a host");
      const verdict = await deps.netguard.check({ ...remote, purpose: "files" });
      if (!verdict.allowed) throw refusal(verdict, remote);
      const config = v.parse(journaldConfigSchema, validated.config);
      const trust = hostKeyTrust(deps, adapter.id, trustAs);
      const shell = deps.openShell({
        ...sshConfigOf(config, secrets, trust.verify),
        address: verdict.addresses[0] ?? remote.host,
      });
      return { adapter, config, shell: untrustedAware(shell, trust.untrusted) };
    },
  };
}

/** What a first `journalctl -n 1` says about the host, as warnings with their fix (J5). */
export function journalWarnings(result: ShellResult, user: string): EngineWarning[] {
  const said = `${result.stderr}\n${result.stdout}`;
  if (
    /no journal files were found/i.test(said) ||
    (result.code === 0 && result.stdout.trim() === "")
  )
    return [{ code: "no_journal", message: "journalctl found no journal on this host yet" }];
  if (
    result.code !== 0 ||
    /not seeing messages from other users|permission|insufficient/i.test(result.stderr)
  )
    return [
      {
        code: "journal_access",
        message: `${user} cannot read the whole journal: usermod -aG systemd-journal ${user}`,
      },
    ];
  return [];
}

/** Test connection: one line of the journal over the login; any host key passes, as no row exists yet. */
export async function probeJournald(
  openShell: OpenShell,
  config: JsonObject,
  secrets: Secrets,
  target?: CheckedTarget
): Promise<FileProbeResult> {
  const parsed = v.parse(journaldConfigSchema, config);
  const ssh = sshConfigOf(parsed, secrets, () => true);
  if (target !== undefined) ssh.address = target.address;
  const shell = openShell(ssh);
  try {
    const result = await shell.run(journalCommand({ lines: 1, units: [] }), 64 * 1024);
    return {
      engine: "journald",
      tier: "logs",
      reachable: true,
      warnings: journalWarnings(result, parsed.user),
    };
  } finally {
    await shell.close();
  }
}

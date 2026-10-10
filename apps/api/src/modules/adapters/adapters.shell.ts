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
import type { SshLogin } from "../../lib/logs/ssh.ts";
import { validateConfig } from "./adapters.config.ts";
import { hostKeyTrust, requireStorage } from "./adapters.files.ts";
import type { HostKeyTrust } from "./adapters.files.ts";
import type { FilesResolverDeps } from "./adapters.files.ts";
import { refusal } from "./adapters.helpers.ts";
import type { AdapterRecord } from "./adapters.repository.ts";
import { CONFIG_COLUMN, openSecrets } from "./adapters.secrets.ts";
import type { Secrets } from "./adapters.secrets.ts";

export type OpenShell = (config: SshLogin) => Shell;

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
  config: Pick<JournaldConfig, "host" | "port" | "user">,
  secrets: Secrets,
  verifyHostKey: SshLogin["verifyHostKey"]
): SshLogin {
  const ssh: SshLogin = {
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
export async function trustGuarded<T>(
  task: () => Promise<T>,
  untrusted: () => boolean
): Promise<T> {
  try {
    return await task();
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
}

function untrustedAware(shell: Shell, untrusted: () => boolean): Shell {
  return {
    run: (command, capBytes) => trustGuarded(() => shell.run(command, capBytes), untrusted),
    close: () => shell.close(),
  };
}

export type CheckedLogin = {
  adapter: AdapterRecord;
  config: JsonObject;
  secrets: Secrets;
  /** The address netguard approved. */
  address: string;
  trust: HostKeyTrust;
};

/** A stored remote log adapter's opened secrets, its checked address and its host-key trust. */
export async function checkedLogin(
  deps: Omit<ShellResolverDeps, "openShell">,
  projectId: string,
  adapterId: string,
  engine: "journald" | "docker",
  trustAs: string | null
): Promise<CheckedLogin> {
  const adapter = requireStorage(deps.repo.byId(adapterId), projectId, "logs");
  if (adapter.engine !== engine)
    throw new AppError("ENGINE_UNSUPPORTED", `this is not a ${engine} adapter`, {
      reason: "engine",
    });
  const secrets = await openSecrets(deps.ring, adapter.id, CONFIG_COLUMN, adapter.config_sealed);
  const validated = validateConfig(adapter.engine, adapter.kind, adapter.config, secrets);
  const remote = validated.target;
  if (remote === null) throw new AppError("INTERNAL", `a ${engine} adapter has a host`);
  const verdict = await deps.netguard.check({ ...remote, purpose: "files" });
  if (!verdict.allowed) throw refusal(verdict, remote);
  return {
    adapter,
    config: validated.config,
    secrets,
    address: verdict.addresses[0] ?? remote.host,
    trust: hostKeyTrust(deps, adapter.id, trustAs),
  };
}

export function createShellResolver(deps: ShellResolverDeps): ShellResolver {
  return {
    async resolve(projectId, adapterId, trustAs) {
      const login = await checkedLogin(deps, projectId, adapterId, "journald", trustAs);
      const config = v.parse(journaldConfigSchema, login.config);
      const shell = deps.openShell({
        ...sshConfigOf(config, login.secrets, login.trust.verify),
        address: login.address,
      });
      return {
        adapter: login.adapter,
        config,
        shell: untrustedAware(shell, login.trust.untrusted),
      };
    },
  };
}

/** What a first `journalctl -n 1` says about the host, as warnings with their fix (J5). */
export function journalWarnings(result: ShellResult, user: string): EngineWarning[] {
  const said = `${result.stderr}\n${result.stdout}`;
  // A shell answers 127 for a command it cannot find: a host without systemd.
  if (result.code === 127 || /journalctl: (command )?not found/i.test(result.stderr))
    return [
      { code: "no_journalctl", message: "this host has no journalctl: it does not run systemd" },
    ];
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

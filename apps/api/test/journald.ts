import { AppError } from "../src/lib/http/index.ts";
import type { Shell } from "../src/lib/logs/journald/read.ts";
import type { OpenShell } from "../src/modules/adapters/adapters.shell.ts";

/** One journal entry as `journalctl -o json` writes it, with the fields the tests use. */
export type JournalRow = {
  __CURSOR: string;
  __REALTIME_TIMESTAMP: string;
  PRIORITY?: string;
  MESSAGE?: string;
  _SYSTEMD_UNIT?: string;
};

/** A host that answers like journalctl for -n, -r, --cursor, --after-cursor and -u (#86). */
export function journalShell(rows: readonly JournalRow[]): Shell & { commands: string[] } {
  const commands: string[] = [];
  return {
    commands,
    async run(command) {
      commands.push(command);
      const arg = (name: string) => command.match(new RegExp(`'${name}([^']*)'`))?.[1];
      const n = Number(command.match(/'-n' '(\d+)'/)?.[1]);
      const units = [...command.matchAll(/'-u' '([^']+)'/g)].map((match) => match[1]);
      const at = arg("--cursor=");
      const after = arg("--after-cursor=");
      let kept = rows.filter(
        (row) => units.length === 0 || units.includes(row._SYSTEMD_UNIT ?? "")
      );
      if (after !== undefined)
        kept = kept.slice(kept.findIndex((row) => row.__CURSOR === after) + 1).slice(-n);
      else if (at !== undefined)
        kept = kept
          .slice(0, kept.findIndex((row) => row.__CURSOR === at) + 1)
          .reverse()
          .slice(0, n);
      else kept = kept.slice(-n);
      return {
        stdout: kept.map((row) => JSON.stringify(row)).join("\n"),
        stderr: "",
        code: 0,
        capped: false,
      };
    },
    close: async () => undefined,
  };
}

/**
 * The harness's SSH hosts: each host name's journal, behind a host key the test can change, so
 * first-use trust and a changed key both run through the real resolver.
 */
export function memoryOpenShell(
  journals: Map<string, JournalRow[]>,
  hostKey: { current: string }
): OpenShell {
  return (config) => {
    const shell = journalShell(journals.get(config.host) ?? []);
    return {
      async run(command, cap) {
        if (!config.verifyHostKey({ type: "ssh-ed25519", fingerprint: hostKey.current }))
          throw new AppError("CONFLICT", "the SSH host key changed", {
            reason: "host_key_changed",
          });
        return shell.run(command, cap);
      },
      close: async () => undefined,
    };
  };
}

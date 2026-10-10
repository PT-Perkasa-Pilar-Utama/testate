/**
 * A command channel over SSH (#86; J1 of docs/decisions/2026-10-10-journald.md): the SFTP adapter's
 * login and host-key trust, but an `exec` channel. It runs only what `journalCommand` built.
 */
import { unreachable } from "../../files/index.ts";
import { createSshSession } from "../ssh.ts";
import type { SshLogin } from "../ssh.ts";
import type { Shell, ShellResult } from "./read.ts";

/** stderr is read for a reason, not kept: at most this much. */
const STDERR_CAP = 64 * 1024;

export function createSshShell(login: SshLogin): Shell {
  const session = createSshSession(login);
  return {
    async run(command, capBytes) {
      const ssh = await session.client();
      return new Promise<ShellResult>((resolve, reject) => {
        ssh.exec(command, (error, stream) => {
          if (error !== undefined) return reject(unreachable(error, "ssh", session.where));
          const out: Buffer[] = [];
          let size = 0;
          let err = "";
          let code: number | null = null;
          let capped = false;
          stream.on("data", (chunk: Buffer) => {
            if (capped) return;
            out.push(chunk);
            size += chunk.length;
            // Past the ceiling the rest is not read: the channel closes and the page says bytes.
            if (size >= capBytes) {
              capped = true;
              stream.close();
            }
          });
          stream.stderr.on("data", (chunk: Buffer) => {
            if (err.length < STDERR_CAP) err += chunk.toString();
          });
          stream.on("exit", (exit: number | null) => {
            code = exit;
          });
          stream.on("close", () => {
            const stdout = Buffer.concat(out).subarray(0, capBytes).toString();
            resolve({ stdout, stderr: err, code: capped ? null : code, capped });
          });
        });
      });
    },
    close: () => session.close(),
  };
}

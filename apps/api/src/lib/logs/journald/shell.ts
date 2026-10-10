/**
 * A command channel over SSH (#86; J1 of docs/decisions/2026-10-10-journald.md): the SFTP adapter's
 * login and host-key trust, but an `exec` channel. It runs only what `journalCommand` built.
 */
import { Client } from "ssh2";
import type { ConnectConfig } from "ssh2";

import { AppError } from "../../http/index.ts";
import { unreachable } from "../../files/index.ts";
import type { HostKey, HostKeyVerifier } from "../../files/index.ts";
import { hostKeyOf } from "../../files/sftp.ts";
import type { Shell, ShellResult } from "./read.ts";

export type SshShellConfig = {
  host: string;
  /** The address netguard returned for this connection. */
  address?: string;
  port: number;
  user: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  verifyHostKey: HostKeyVerifier;
  timeoutMs?: number;
};

/** stderr is read for a reason, not kept: at most this much. */
const STDERR_CAP = 64 * 1024;

function connectOptions(config: SshShellConfig, onKey: (key: HostKey) => boolean): ConnectConfig {
  const options: ConnectConfig = {
    host: config.address ?? config.host,
    port: config.port,
    username: config.user,
    readyTimeout: config.timeoutMs ?? 15000,
    hostVerifier: (raw: Buffer): boolean => onKey(hostKeyOf(raw)),
  };
  if (config.password !== undefined) options.password = config.password;
  if (config.privateKey !== undefined) options.privateKey = config.privateKey;
  if (config.passphrase !== undefined) options.passphrase = config.passphrase;
  return options;
}

export function createSshShell(config: SshShellConfig): Shell {
  const where = `${config.host}:${config.port}`;
  let client: Client | null = null;
  let rejected: HostKey | null = null;
  const connect = (): Promise<Client> =>
    new Promise((resolve, reject) => {
      if (client !== null) return resolve(client);
      const next = new Client();
      next.on("ready", () => {
        client = next;
        resolve(next);
      });
      next.on("error", (cause: Error) => {
        if (rejected === null) return reject(unreachable(cause, "ssh", where));
        reject(
          new AppError("CONFLICT", "the SSH host key changed", {
            reason: "host_key_changed",
            details: { fingerprint: rejected.fingerprint, key_type: rejected.type },
          })
        );
      });
      next.connect(
        connectOptions(config, (key) => {
          const ok = config.verifyHostKey(key);
          if (!ok) rejected = key;
          return ok;
        })
      );
    });
  return {
    async run(command, capBytes) {
      const ssh = await connect();
      return new Promise<ShellResult>((resolve, reject) => {
        ssh.exec(command, (error, stream) => {
          if (error !== undefined) return reject(unreachable(error, "ssh", where));
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
    async close() {
      client?.end();
      client = null;
    },
  };
}

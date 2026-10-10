/**
 * One SSH login with the SFTP adapter's host-key trust, shared by the log engines that reach a host
 * over SSH: journald's `exec` channel (#86) and docker's socket channel (#88).
 */
import { Client } from "ssh2";
import type { ConnectConfig } from "ssh2";

import { AppError } from "../http/index.ts";
import { unreachable } from "../files/index.ts";
import type { HostKey, HostKeyVerifier } from "../files/index.ts";
import { hostKeyOf } from "../files/sftp.ts";

export type SshLogin = {
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

/** A connection made on first use and kept until `close`. */
export type SshSession = {
  client(): Promise<Client>;
  /** `host:port`, for an error message. */
  where: string;
  close(): Promise<void>;
};

function connectOptions(login: SshLogin, onKey: (key: HostKey) => boolean): ConnectConfig {
  const options: ConnectConfig = {
    host: login.address ?? login.host,
    port: login.port,
    username: login.user,
    readyTimeout: login.timeoutMs ?? 15000,
    hostVerifier: (raw: Buffer): boolean => onKey(hostKeyOf(raw)),
  };
  if (login.password !== undefined) options.password = login.password;
  if (login.privateKey !== undefined) options.privateKey = login.privateKey;
  if (login.passphrase !== undefined) options.passphrase = login.passphrase;
  return options;
}

export function createSshSession(login: SshLogin): SshSession {
  const where = `${login.host}:${login.port}`;
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
        connectOptions(login, (key) => {
          const ok = login.verifyHostKey(key);
          if (!ok) rejected = key;
          return ok;
        })
      );
    });
  return {
    client: connect,
    where,
    async close() {
      client?.end();
      client = null;
    },
  };
}

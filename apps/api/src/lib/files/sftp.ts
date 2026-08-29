import { Readable } from "node:stream";
import type { Entry } from "@testate/shared";
import SftpClient from "ssh2-sftp-client";

import { AppError } from "../http/index.ts";
import {
  byName,
  joinPath,
  missing,
  nameOf,
  normalizePath,
  pageEntries,
  unreachable,
} from "./index.ts";
import type { FileSource, HostKey, HostKeyVerifier } from "./index.ts";

export type SftpSourceConfig = {
  host: string;
  port: number;
  user: string;
  root_path: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  verifyHostKey: HostKeyVerifier;
  timeoutMs?: number;
};

/** The SSH wire format starts with a length-prefixed key type, for example `ssh-ed25519`. */
export function hostKeyOf(raw: Uint8Array): HostKey {
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const length = raw.byteLength >= 4 ? view.getUint32(0) : 0;
  const type = new TextDecoder().decode(raw.subarray(4, 4 + length));
  const fingerprint = new Bun.CryptoHasher("sha256")
    .update(raw)
    .digest("base64")
    .replace(/=+$/, "");
  return { type, fingerprint: `SHA256:${fingerprint}` };
}

function isMissing(cause: unknown): boolean {
  return cause instanceof Error && /no such file|not found|ENOENT|code: 2\b/i.test(cause.message);
}

/**
 * SFTP through `ssh2-sftp-client` (10 §10.3). The addon never builds because `bun install` runs
 * no lifecycle scripts, so ssh2 stays on its pure-JS crypto.
 * ponytail: never add ssh2 to `trustedDependencies` — the native addon crashes under Bun.
 */
export function createSftpSource(config: SftpSourceConfig): FileSource {
  let client: SftpClient | null = null;
  let rejected: HostKey | null = null;
  const connect = async (): Promise<SftpClient> => {
    if (client !== null) return client;
    const next = new SftpClient();
    const options: Parameters<SftpClient["connect"]>[0] = {
      host: config.host,
      port: config.port,
      username: config.user,
      readyTimeout: config.timeoutMs ?? 15000,
      retries: 0,
      hostVerifier: (raw: Buffer): boolean => {
        const key = hostKeyOf(raw);
        const ok = config.verifyHostKey(key);
        if (!ok) rejected = key;
        return ok;
      },
    };
    if (config.password !== undefined) options.password = config.password;
    if (config.privateKey !== undefined) options.privateKey = config.privateKey;
    if (config.passphrase !== undefined) options.passphrase = config.passphrase;
    try {
      await next.connect(options);
    } catch (cause: unknown) {
      if (rejected !== null) {
        throw new AppError("CONFLICT", "the SFTP host key changed", {
          reason: "host_key_changed",
          details: { fingerprint: rejected.fingerprint, key_type: rejected.type },
        });
      }
      throw unreachable(cause, "ssh");
    }
    client = next;
    return next;
  };
  const guard = async <T>(path: string, run: (sftp: SftpClient) => Promise<T>): Promise<T> => {
    const sftp = await connect();
    try {
      return await run(sftp);
    } catch (cause: unknown) {
      if (cause instanceof AppError) throw cause;
      throw isMissing(cause) ? missing(path) : unreachable(cause, "sftp");
    }
  };
  const entryOf = (
    dir: string,
    item: { name: string; type: string; size: number; modifyTime: number }
  ): Entry => ({
    name: item.name,
    path: dir === "" ? item.name : `${dir}/${item.name}`,
    kind: item.type === "d" ? "directory" : "file",
    size_bytes: item.type === "d" ? null : item.size,
    modified_at: item.type === "d" ? null : new Date(item.modifyTime).toISOString(),
  });
  return {
    async list(path, query) {
      const dir = normalizePath(path);
      return guard(dir, async (sftp) => {
        const items = await sftp.list(joinPath(config.root_path, dir));
        return pageEntries(items.map((item) => entryOf(dir, item)).sort(byName), query);
      });
    },
    async stat(path) {
      const clean = normalizePath(path);
      return guard(clean, async (sftp) => {
        const stats = await sftp.stat(joinPath(config.root_path, clean));
        return {
          name: nameOf(clean),
          path: clean,
          kind: stats.isDirectory ? "directory" : "file",
          size_bytes: stats.isDirectory ? null : stats.size,
          modified_at: stats.isDirectory ? null : new Date(stats.modifyTime).toISOString(),
        };
      });
    },
    async read(path) {
      const clean = normalizePath(path);
      return guard(clean, async (sftp) => {
        await sftp.stat(joinPath(config.root_path, clean));
        return Readable.toWeb(sftp.createReadStream(joinPath(config.root_path, clean)));
      });
    },
    async close() {
      const open = client;
      client = null;
      if (open !== null) await open.end().catch(() => false);
    },
  };
}

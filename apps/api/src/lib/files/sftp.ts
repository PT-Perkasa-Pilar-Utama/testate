import { Readable } from "node:stream";
import type { Entry } from "@testate/shared";
import type { SFTPWrapper } from "ssh2";
import SftpClient from "ssh2-sftp-client";
import * as v from "valibot";

import { AppError } from "../http/index.ts";
import { HOST_FILES } from "../resources/host.ts";
import type { HostIo, Statvfs } from "../resources/host.ts";
import {
  alreadyThere,
  byName,
  joinPath,
  missing,
  nameOf,
  normalizePath,
  notAFile,
  notEmpty,
  pageEntries,
  unreachable,
} from "./index.ts";
import type { FileSource, HostKey, HostKeyVerifier } from "./index.ts";

export type SftpSourceConfig = {
  host: string;
  /** The address returned by netguard for this source lifetime. */
  address?: string;
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
 * ponytail: never add ssh2 to `trustedDependencies`; the native addon crashes under Bun.
 */
export function createSftpSource(
  config: SftpSourceConfig,
  createClient: () => SftpClient = () => new SftpClient()
): FileSource {
  const where = `${config.host}:${config.port}`;
  let client: SftpClient | null = null;
  let wrapper: SFTPWrapper | null = null;
  let rejected: HostKey | null = null;
  // Calls made together share one connect: each used to open its own, and close() ended only the
  // last, so a parallel read (a resource reading's five) left SSH connections open behind it.
  let connecting: Promise<SftpClient> | null = null;
  const connect = async (): Promise<SftpClient> => {
    if (client !== null) return client;
    connecting ??= open();
    try {
      return await connecting;
    } finally {
      connecting = null;
    }
  };
  const open = async (): Promise<SftpClient> => {
    const next = createClient();
    const options: Parameters<SftpClient["connect"]>[0] = {
      host: config.address ?? config.host,
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
      wrapper = await next.connect(options);
    } catch (cause: unknown) {
      if (rejected !== null) {
        throw new AppError("CONFLICT", "the SFTP host key changed", {
          reason: "host_key_changed",
          details: { fingerprint: rejected.fingerprint, key_type: rejected.type },
        });
      }
      throw unreachable(cause, "ssh", where);
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
      throw isMissing(cause) ? missing(path) : unreachable(cause, "sftp", where);
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
    async readRange(path, start, end) {
      const clean = normalizePath(path);
      if (end <= start) return new Uint8Array();
      return guard(clean, async (sftp) => {
        // ssh2's `end` is inclusive.
        const stream = sftp.createReadStream(joinPath(config.root_path, clean), {
          start,
          end: end - 1,
        });
        const parts: Uint8Array[] = [];
        for await (const part of stream) parts.push(new Uint8Array(part));
        return new Uint8Array(Buffer.concat(parts));
      });
    },
    async put(path, body) {
      const clean = normalizePath(path);
      if (clean === "") throw notAFile(clean);
      return guard(clean, async (sftp) => {
        const parent = clean.includes("/") ? clean.slice(0, clean.lastIndexOf("/")) : "";
        if (parent !== "") await sftp.mkdir(joinPath(config.root_path, parent), true);
        await sftp.put(Buffer.from(body), joinPath(config.root_path, clean));
      });
    },
    async remove(path) {
      const clean = normalizePath(path);
      return guard(clean, async (sftp) => {
        const stats = await sftp.stat(joinPath(config.root_path, clean));
        if (stats.isDirectory) throw notAFile(clean);
        await sftp.delete(joinPath(config.root_path, clean));
      });
    },
    async makeDirectory(path) {
      const clean = normalizePath(path);
      if (clean === "") throw notAFile(clean);
      return guard(clean, async (sftp) => {
        if ((await sftp.exists(joinPath(config.root_path, clean))) !== false)
          throw alreadyThere(clean);
        await sftp.mkdir(joinPath(config.root_path, clean), true);
      });
    },
    async removeDirectory(path) {
      const clean = normalizePath(path);
      if (clean === "") throw notAFile(clean);
      return guard(clean, async (sftp) => {
        const stats = await sftp.stat(joinPath(config.root_path, clean));
        if (!stats.isDirectory) throw notAFile(clean);
        if ((await sftp.list(joinPath(config.root_path, clean))).length > 0) throw notEmpty(clean);
        await sftp.rmdir(joinPath(config.root_path, clean));
      });
    },
    async move(from, to) {
      const source = normalizePath(from);
      const target = normalizePath(to);
      if (target === "") throw notAFile(target);
      return guard(source, async (sftp) => {
        if ((await sftp.stat(joinPath(config.root_path, source))).isDirectory)
          throw notAFile(source);
        // `exists` answers "" for nothing there, and a letter for what is: the protocol's own
        // rename would clobber a file, and SFTP servers differ on whether they even allow it.
        if ((await sftp.exists(joinPath(config.root_path, target))) !== false)
          throw alreadyThere(target);
        const parent = target.includes("/") ? target.slice(0, target.lastIndexOf("/")) : "";
        if (parent !== "") await sftp.mkdir(joinPath(config.root_path, parent), true);
        await sftp.rename(joinPath(config.root_path, source), joinPath(config.root_path, target));
      });
    },
    host: hostOf(config.root_path, async () => {
      const sftp = await connect();
      if (wrapper === null) throw unreachable(new Error("no SFTP channel"), "sftp", where);
      return { client: sftp, wrapper };
    }),
    async close() {
      let opened = client;
      if (opened === null && connecting !== null) {
        try {
          opened = await connecting;
        } catch {
          opened = null;
        }
      }
      client = null;
      wrapper = null;
      if (opened !== null) await opened.end().catch(() => false);
    },
  };
}

/** A `/proc` file is small; this caps a server that streams something else at that path. */
const HOST_TEXT_MAX = 256 * 1024;

const statvfsAnswer = v.object({
  f_frsize: v.number(),
  f_blocks: v.number(),
  f_bavail: v.number(),
});

type Channel = { client: SftpClient; wrapper: SFTPWrapper };

/**
 * The host behind the login (#38): only the files in HOST_FILES, by absolute path, whatever the
 * root; and the disk the root sits on, through the OpenSSH `statvfs` extension.
 */
function hostOf(rootPath: string, channel: () => Promise<Channel>): HostIo {
  return {
    async text(path) {
      if (!HOST_FILES.some((file) => file === path))
        throw new AppError("VALIDATION_ERROR", `${path} is not a host file Testate reads`);
      const { client } = await channel();
      const parts: Uint8Array[] = [];
      let size = 0;
      for await (const part of client.createReadStream(path)) {
        parts.push(new Uint8Array(part));
        size += part.length;
        if (size > HOST_TEXT_MAX) break;
      }
      return Buffer.concat(parts).subarray(0, HOST_TEXT_MAX).toString("utf8");
    },
    async statvfs(path) {
      const { wrapper } = await channel();
      const target = joinPath(rootPath, normalizePath(path));
      return new Promise<Statvfs>((resolve, reject) => {
        wrapper.ext_openssh_statvfs(target, (error, info) => {
          if (error !== undefined) reject(error);
          else resolve(v.parse(statvfsAnswer, info));
        });
      });
    },
  };
}

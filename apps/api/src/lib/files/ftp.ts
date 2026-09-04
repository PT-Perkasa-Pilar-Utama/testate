import { PassThrough, Readable } from "node:stream";
import type { Entry } from "@testate/shared";
import { Client } from "basic-ftp";
import type { FileInfo } from "basic-ftp";
import * as v from "valibot";

import { AppError } from "../http/index.ts";
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
import type { FileSource } from "./index.ts";

export type FtpSourceConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  root_path: string;
  tls: boolean;
  timeoutMs?: number;
};

type FtpFailure = { code: number | undefined; message: string };
const withCode = v.object({ code: v.number() });

function ftpError(cause: unknown): FtpFailure {
  const code = v.is(withCode, cause) ? cause.code : undefined;
  return { code, message: cause instanceof Error ? cause.message : String(cause) };
}

function entryOf(dir: string, item: FileInfo): Entry {
  const directory = item.isDirectory;
  return {
    name: item.name,
    path: dir === "" ? item.name : `${dir}/${item.name}`,
    kind: directory ? "directory" : "file",
    size_bytes: directory ? null : item.size,
    modified_at: directory || item.modifiedAt === undefined ? null : item.modifiedAt.toISOString(),
  };
}

/** Streams one file into the pipe; a transfer failure destroys the pipe so the reader sees it. */
async function download(ftp: Client, pipe: PassThrough, remote: string): Promise<void> {
  try {
    await ftp.downloadTo(pipe, remote);
  } catch (cause: unknown) {
    pipe.destroy(cause instanceof Error ? cause : new Error(String(cause)));
  } finally {
    ftp.close();
  }
}

/** FTP and explicit FTPS through `basic-ftp` (10 §10.3), passive mode only. */
export function createFtpSource(config: FtpSourceConfig): FileSource {
  const where = `${config.host}:${config.port}`;
  let client: Client | null = null;
  const connectNew = async (): Promise<Client> => {
    const next = new Client(config.timeoutMs ?? 15000);
    try {
      await next.access({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        secure: config.tls,
      });
    } catch (cause: unknown) {
      throw unreachable(cause, `ftp_${ftpError(cause).code ?? "connect"}`, where);
    }
    return next;
  };
  const connect = async (): Promise<Client> => {
    if (client !== null && !client.closed) return client;
    client = await connectNew();
    return client;
  };
  const guard = async <T>(path: string, run: (ftp: Client) => Promise<T>): Promise<T> => {
    const ftp = await connect();
    try {
      return await run(ftp);
    } catch (cause: unknown) {
      if (cause instanceof AppError) throw cause;
      const { code } = ftpError(cause);
      throw code === 550 ? missing(path) : unreachable(cause, `ftp_${code ?? "unknown"}`, where);
    }
  };
  const listDir = async (ftp: Client, dir: string): Promise<Entry[]> => {
    const items = await ftp.list(joinPath(config.root_path, dir));
    return items
      .filter((item) => item.name !== "." && item.name !== "..")
      .map((item) => entryOf(dir, item))
      .sort(byName);
  };
  return {
    async list(path, query) {
      const dir = normalizePath(path);
      return guard(dir, async (ftp) => pageEntries(await listDir(ftp, dir), query));
    },
    async stat(path) {
      const clean = normalizePath(path);
      if (clean === "")
        return { name: "", path: "", kind: "directory", size_bytes: null, modified_at: null };
      const parent = clean.includes("/") ? clean.slice(0, clean.lastIndexOf("/")) : "";
      return guard(clean, async (ftp) => {
        const entry = (await listDir(ftp, parent)).find((item) => item.name === nameOf(clean));
        if (entry === undefined) throw missing(clean);
        return entry;
      });
    },
    async read(path) {
      const clean = normalizePath(path);
      return guard(clean, async (ftp) => {
        const size = await ftp.size(joinPath(config.root_path, clean));
        if (size < 0) throw missing(clean);
        // An FTP session runs one transfer at a time, so the download gets its own session.
        const pipe = new PassThrough();
        void download(await connectNew(), pipe, joinPath(config.root_path, clean));
        return Readable.toWeb(pipe);
      });
    },
    async put(path, body) {
      const clean = normalizePath(path);
      if (clean === "") throw notAFile(clean);
      return guard(clean, async (ftp) => {
        const parent = clean.includes("/") ? clean.slice(0, clean.lastIndexOf("/")) : "";
        // `ensureDir` leaves the session in the directory it made, and every other call here is
        // written against an absolute path, so put it back where it was.
        if (parent !== "") await ftp.ensureDir(joinPath(config.root_path, parent));
        await ftp.cd("/");
        await ftp.uploadFrom(Readable.from([Buffer.from(body)]), joinPath(config.root_path, clean));
      });
    },
    async remove(path) {
      const clean = normalizePath(path);
      return guard(clean, async (ftp) => {
        const parent = clean.includes("/") ? clean.slice(0, clean.lastIndexOf("/")) : "";
        const entry = (await listDir(ftp, parent)).find((item) => item.name === nameOf(clean));
        if (entry === undefined) throw missing(clean);
        if (entry.kind === "directory") throw notAFile(clean);
        await ftp.remove(joinPath(config.root_path, clean));
      });
    },
    async makeDirectory(path) {
      const clean = normalizePath(path);
      if (clean === "") throw notAFile(clean);
      return guard(clean, async (ftp) => {
        const parent = clean.includes("/") ? clean.slice(0, clean.lastIndexOf("/")) : "";
        const there = (await listDir(ftp, parent).catch(() => [])).find(
          (item) => item.name === nameOf(clean)
        );
        if (there !== undefined) throw alreadyThere(clean);
        await ftp.ensureDir(joinPath(config.root_path, clean));
        await ftp.cd("/");
      });
    },
    async removeDirectory(path) {
      const clean = normalizePath(path);
      if (clean === "") throw notAFile(clean);
      return guard(clean, async (ftp) => {
        if ((await listDir(ftp, clean)).length > 0) throw notEmpty(clean);
        await ftp.cd("/");
        await ftp.removeDir(joinPath(config.root_path, clean));
      });
    },
    async move(from, to) {
      const source = normalizePath(from);
      const target = normalizePath(to);
      if (target === "") throw notAFile(target);
      return guard(source, async (ftp) => {
        const parent = source.includes("/") ? source.slice(0, source.lastIndexOf("/")) : "";
        const entry = (await listDir(ftp, parent)).find((item) => item.name === nameOf(source));
        if (entry === undefined) throw missing(source);
        if (entry.kind === "directory") throw notAFile(source);
        const into = target.includes("/") ? target.slice(0, target.lastIndexOf("/")) : "";
        const there = (await listDir(ftp, into).catch(() => [])).find(
          (item) => item.name === nameOf(target)
        );
        if (there !== undefined) throw alreadyThere(target);
        if (into !== "") await ftp.ensureDir(joinPath(config.root_path, into));
        await ftp.cd("/");
        await ftp.rename(joinPath(config.root_path, source), joinPath(config.root_path, target));
      });
    },
    async close() {
      const open = client;
      client = null;
      open?.close();
    },
  };
}

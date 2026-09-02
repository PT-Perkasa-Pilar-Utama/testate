import { describe, expect, test } from "bun:test";
import { S3Client } from "bun";
import { Client as Ftp } from "basic-ftp";
import SftpClient from "ssh2-sftp-client";

import { createFtpSource } from "./ftp.ts";
import type { FileSource } from "./index.ts";
import { createS3Source } from "./s3.ts";
import { createSftpSource } from "./sftp.ts";

/** Contract tests against `deploy/compose.engines.yml` (minio 9010, sftp 22220, ftp 21210); skipped when absent. */
const S3 = {
  bucket: "exports",
  prefix: "contract",
  region: "us-east-1",
  endpoint: "http://127.0.0.1:9010",
  virtual_hosted: false,
  accessKeyId: "testate",
  secretAccessKey: "testate-minio",
};
const SFTP = {
  host: "127.0.0.1",
  port: 22220,
  user: "testate",
  password: "testate",
  root_path: "/upload",
};
const FTP = {
  host: "127.0.0.1",
  port: 21210,
  user: "testate",
  password: "testate",
  root_path: "/ftp/testate",
  tls: false,
};

const FILES: [string, string][] = [
  ["exports/a.csv", "id,name\n1,x\n"],
  ["exports/b.txt", "hello"],
  ["readme.md", "# hi"],
];

/** Skips unless the service answers a real call; a stray listener on the port is not enough. */
async function reachable(probe: () => Promise<void>): Promise<boolean> {
  try {
    await probe();
    return true;
  } catch {
    return false;
  }
}

const s3Up = reachable(async () => {
  await new S3Client({ ...S3 }).list({ maxKeys: 1 });
});
const sftpUp = reachable(async () => {
  const sftp = new SftpClient();
  await sftp.connect({
    host: SFTP.host,
    port: SFTP.port,
    username: SFTP.user,
    password: SFTP.password,
    readyTimeout: 2000,
  });
  await sftp.end();
});
const ftpUp = reachable(async () => {
  const ftp = new Ftp(2000);
  await ftp.access({ host: FTP.host, port: FTP.port, user: FTP.user, password: FTP.password });
  ftp.close();
});

async function seedS3(): Promise<void> {
  const client = new S3Client({ ...S3 });
  for (const [path, body] of FILES) await client.write(`${S3.prefix}/${path}`, body);
}

async function seedSftp(): Promise<void> {
  const sftp = new SftpClient();
  await sftp.connect({
    host: SFTP.host,
    port: SFTP.port,
    username: SFTP.user,
    password: SFTP.password,
  });
  await sftp.mkdir(`${SFTP.root_path}/exports`, true).catch(() => "");
  for (const [path, body] of FILES) await sftp.put(Buffer.from(body), `${SFTP.root_path}/${path}`);
  await sftp.end();
}

async function seedFtp(): Promise<void> {
  const ftp = new Ftp();
  await ftp.access({ host: FTP.host, port: FTP.port, user: FTP.user, password: FTP.password });
  await ftp.ensureDir(`${FTP.root_path}/exports`);
  await ftp.cd(FTP.root_path);
  const { Readable } = await import("node:stream");
  for (const [path, body] of FILES) await ftp.uploadFrom(Readable.from([Buffer.from(body)]), path);
  ftp.close();
}

function cursorOf(page: { next_cursor: string | null }): string {
  if (page.next_cursor === null) throw new Error("no next cursor");
  return page.next_cursor;
}

function behavesLikeATree(open: () => FileSource): void {
  test("lists directories first, stats files, reads bytes, and reports missing entries", async () => {
    const source = open();
    try {
      const root = await source.list("", { limit: 10 });
      expect(root.data.map((entry) => `${entry.kind}:${entry.path}`)).toEqual([
        "directory:exports",
        "file:readme.md",
      ]);
      const page = await source.list("exports", { limit: 1 });
      expect(page.data.map((entry) => entry.name)).toEqual(["a.csv"]);
      expect(page.next_cursor).not.toBeNull();
      const rest = await source.list("exports", { limit: 1, cursor: cursorOf(page) });
      expect(rest.data.map((entry) => entry.name)).toEqual(["b.txt"]);
      const stat = await source.stat("exports/b.txt");
      expect(stat).toMatchObject({ kind: "file", size_bytes: 5, name: "b.txt" });
      expect((await source.stat("exports")).kind).toBe("directory");
      expect(await new Response(await source.read("exports/a.csv")).text()).toBe("id,name\n1,x\n");
      await expect(source.stat("exports/nope.txt")).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(source.read("exports/nope.txt")).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally {
      await source.close();
    }
  });
}

/**
 * The write half, in a directory of its own that the test empties again.
 *
 * `behavesLikeATree` asserts the exact tree at the root, so a file left behind by this suite fails
 * the read suite on the next run against the same store.
 */
/** Empties the scratch directory the write suite makes, for the two protocols that keep one. */
async function dropSftpDir(): Promise<void> {
  const sftp = new SftpClient();
  await sftp.connect({
    host: SFTP.host,
    port: SFTP.port,
    username: SFTP.user,
    password: SFTP.password,
  });
  await sftp.rmdir(`${SFTP.root_path}/scratch`, true).catch(() => "");
  await sftp.end();
}

async function dropFtpDir(): Promise<void> {
  const ftp = new Ftp();
  await ftp.access({ host: FTP.host, port: FTP.port, user: FTP.user, password: FTP.password });
  await ftp.removeDir(`${FTP.root_path}/scratch`).catch(() => "");
  ftp.close();
}

function writesAndDeletes(open: () => FileSource, dropDir: () => Promise<void>): void {
  test("writes a file, overwrites it, reads it back, then deletes it", async () => {
    const source = open();
    const path = "scratch/note.txt";
    try {
      await source.put(path, new TextEncoder().encode("first"));
      expect((await source.stat(path)).size_bytes).toBe(5);
      await source.put(path, new TextEncoder().encode("second"));
      expect(await new Response(await source.read(path)).text()).toBe("second");
      await source.remove(path);
      await expect(source.stat(path)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(source.remove(path)).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally {
      await source.remove(path).catch(() => "already gone");
      await source.close();
      await dropDir();
    }
  });

  test("renames a file, into another directory too, and refuses to land on something", async () => {
    const source = open();
    const from = "scratch/before.txt";
    const to = "scratch/after.txt";
    const deeper = "scratch/kept/after.txt";
    try {
      await source.put(from, new TextEncoder().encode("hello"));
      await source.move(from, to);
      await expect(source.stat(from)).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(await new Response(await source.read(to)).text()).toBe("hello");
      // A move is also how a file changes directory, and the directory above it may not exist yet.
      await source.move(to, deeper);
      expect((await source.stat(deeper)).size_bytes).toBe(5);
      // Landing on an existing file would destroy it with nothing to undo it from.
      await source.put(from, new TextEncoder().encode("other"));
      await expect(source.move(from, deeper)).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await new Response(await source.read(deeper)).text()).toBe("hello");
      await expect(source.move("scratch/nope.txt", to)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(source.move("scratch", to)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
    } finally {
      for (const path of [from, to, deeper]) await source.remove(path).catch(() => "already gone");
      await source.close();
      await dropDir();
    }
  });

  test("makes an empty directory, lists it, and refuses to make it twice", async () => {
    const source = open();
    const dir = "scratch/empty";
    const inside = "scratch/empty/later.txt";
    try {
      await source.makeDirectory(dir);
      expect((await source.stat(dir)).kind).toBe("directory");
      // Listed as a directory and not as a file: on a key store the folder is a zero-byte key
      // whose name ends in a slash, and a listing that showed it would show a nameless file.
      const page = await source.list("scratch", { limit: 20 });
      expect(
        page.data.filter((entry) => entry.name === "empty").map((entry) => entry.kind)
      ).toEqual(["directory"]);
      await expect(source.makeDirectory(dir)).rejects.toMatchObject({ code: "CONFLICT" });
      await source.put(inside, new TextEncoder().encode("x"));
      expect((await source.list(dir, { limit: 20 })).data.map((entry) => entry.name)).toEqual([
        "later.txt",
      ]);
      // A folder with something in it is not swept away by one press.
      await expect(source.removeDirectory(dir)).rejects.toMatchObject({ code: "CONFLICT" });
      await source.remove(inside);
      await source.removeDirectory(dir);
      await expect(source.stat(dir)).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally {
      await source.remove(inside).catch(() => "already gone");
      await source.removeDirectory(dir).catch(() => "already gone");
      await source.close();
      await dropDir();
    }
  });

  test("refuses to delete a directory", async () => {
    const source = open();
    const path = "scratch/keep/file.txt";
    try {
      await source.put(path, new TextEncoder().encode("x"));
      await expect(source.remove("scratch/keep")).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
    } finally {
      await source.remove(path).catch(() => "already gone");
      await source.close();
      // S3 loses the prefix with its last key; the other two keep the directory, and a leftover
      // one fails `behavesLikeATree` on the next run against the same store.
      await dropDir();
    }
  });
}

describe.skipIf(!(await s3Up))("s3 source (contract)", () => {
  test("seed", seedS3);
  behavesLikeATree(() => createS3Source(S3));
  writesAndDeletes(
    () => createS3Source(S3),
    async () => {
      // S3 loses the prefix with its last key; there is nothing left to drop.
    }
  );
});

describe.skipIf(!(await sftpUp))("sftp source (contract)", () => {
  test("seed", seedSftp);
  behavesLikeATree(() => createSftpSource({ ...SFTP, verifyHostKey: () => true }));
  writesAndDeletes(() => createSftpSource({ ...SFTP, verifyHostKey: () => true }), dropSftpDir);
  test("a rejected host key surfaces as CONFLICT with the fingerprint", async () => {
    const source = createSftpSource({ ...SFTP, verifyHostKey: () => false });
    await expect(source.list("", { limit: 1 })).rejects.toMatchObject({
      code: "CONFLICT",
      details: { reason: "host_key_changed" },
    });
  });
});

describe.skipIf(!(await ftpUp))("ftp source (contract)", () => {
  test("seed", seedFtp);
  behavesLikeATree(() => createFtpSource(FTP));
  writesAndDeletes(() => createFtpSource(FTP), dropFtpDir);
});

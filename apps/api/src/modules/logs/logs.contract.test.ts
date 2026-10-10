import { afterAll, describe, expect, test } from "bun:test";
import { S3Client } from "bun";
import type { LogSource } from "@testate/shared";
import SftpClient from "ssh2-sftp-client";

import type { FileSource } from "../../lib/files/index.ts";
import { createS3Source } from "../../lib/files/s3.ts";
import { createSftpSource } from "../../lib/files/sftp.ts";
import { readSource } from "../../lib/logs/source.ts";
import { logFilesOf } from "./logs.service.ts";

/**
 * The logfile read against `deploy/compose.engines.yml` (minio 9010, sftp 22220); skipped when
 * absent. Its files live under their own prefix and are removed afterwards: the files contract
 * suite lists the stores' roots exactly.
 */
const S3 = {
  bucket: "exports",
  prefix: "logs-contract",
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

const OUT = "2026-10-10T08:00:01: GET /orders 200\n2026-10-10T08:00:03: GET /refund 200\n";
const ERR = "2026-10-10T08:00:02: TypeError: x is undefined\n    at handler (server.ts:42)\n";
const encoder = new TextEncoder();

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

/** Writes pm2's two files under `dir`, reads the source, and removes what it wrote. */
async function readsMerged(source: FileSource, dir: string): Promise<string[]> {
  const logSource: LogSource = {
    name: "api",
    glob: `${dir}/api-*.log`,
    format: "pm2",
    patterns: [],
  };
  await source.put(`${dir}/api-out.log`, encoder.encode(OUT));
  await source.put(`${dir}/api-error.log`, encoder.encode(ERR));
  try {
    const page = await readSource(logFilesOf(source), logSource, { source: "api", limit: 200 });
    return page.entries.map((entry) => `${entry.file} ${entry.message.split("\n")[0]}`);
  } finally {
    await source.remove(`${dir}/api-out.log`).catch(() => "already gone");
    await source.remove(`${dir}/api-error.log`).catch(() => "already gone");
  }
}

const MERGED = [
  "api-out.log GET /refund 200",
  "api-error.log TypeError: x is undefined",
  "api-out.log GET /orders 200",
];

describe.skipIf(!(await s3Up))("logfile over S3 (contract)", () => {
  test("reads pm2's out and error files from MinIO, merged by time", async () => {
    const source = createS3Source(S3);
    try {
      expect(await readsMerged(source, "pm2")).toEqual(MERGED);
    } finally {
      await source.close();
    }
  });
});

describe.skipIf(!(await sftpUp))("logfile over SFTP (contract)", () => {
  const source = createSftpSource({ ...SFTP, verifyHostKey: () => true });
  afterAll(async () => {
    await source.removeDirectory("logs-contract").catch(() => "already gone");
    await source.close();
  });
  test("reads pm2's out and error files over SFTP, merged by time", async () => {
    expect(await readsMerged(source, "logs-contract")).toEqual(MERGED);
  });
});

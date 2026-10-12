import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { E2E_DIR } from "../../playwright.config.ts";

/**
 * Writes or removes one object in the compose MinIO bucket the seeded `exports` adapter reads,
 * through Bun's S3 client: Playwright runs under Node, which has no client here. Not through the
 * API: a spec in `flows` turns the seeded store read-only, and the order of specs is not fixed.
 */
function bucket(action: "write" | "delete", path: string, body = ""): void {
  const script = `
    const client = new Bun.S3Client({
      endpoint: "http://127.0.0.1:9010", region: "us-east-1", bucket: "exports",
      accessKeyId: "testate", secretAccessKey: "testate-minio",
    });
    const [action, path, body] = process.argv.slice(1);
    await (action === "write" ? client.write(path, body) : client.delete(path));`;
  const result = spawnSync("bun", ["-e", script, action, path, body], {
    cwd: join(E2E_DIR, ".."),
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`bucket ${action} ${path}: ${result.stderr}`);
}

export function writeObject(path: string, body: string): void {
  bucket("write", path, body);
}

export function deleteObject(path: string): void {
  bucket("delete", path);
}

/**
 * Prints the input key of one CI shard: a hash over the git blob of every tracked file the shard
 * depends on (`inputsOf`). CI stores a pass under it, and a rerun with the same inputs skips the
 * shard. Runs with bare Bun, before packages are installed.
 *
 *   bun e2e/lib/shard-key.ts flows
 */
import { createHash } from "node:crypto";

import { SHARDS, inputsOf, isShard } from "./shards.ts";

const shard = process.argv[2] ?? "";
if (!isShard(shard)) {
  process.stderr.write(`usage: bun e2e/lib/shard-key.ts <${Object.keys(SHARDS).join("|")}>\n`);
  process.exit(2);
}
const listed = Bun.spawnSync(["git", "ls-files", "-s"]);
if (listed.exitCode !== 0) throw new Error(`git ls-files failed: ${listed.stderr.toString()}`);
// `<mode> <blob> <stage>\t<path>`: the blob hash stands for the content, so nothing is read twice.
const entries = new Map(
  listed.stdout
    .toString()
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const [meta = "", path = ""] = line.split("\t");
      return [path, meta.split(" ")[1] ?? ""] as const;
    })
);
const hash = createHash("sha256");
for (const path of inputsOf(shard, [...entries.keys()]).sort()) {
  hash.update(`${path} ${entries.get(path) ?? ""}\n`);
}
process.stdout.write(`${hash.digest("hex").slice(0, 32)}\n`);

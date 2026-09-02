/**
 * Wipes the development environment back to nothing: the API's data directory (metadata, blobs,
 * logs, uploads, the unpacked SPA), the suite's and smoke's scratch trees, both build outputs and
 * the compiled binaries. With `--engines` it also drops the compose databases and brings them up
 * fresh, which is the only way to get the demo tables back to what the seed expects.
 *
 *   bun run reset:dev --yes [--engines]      # or --dry-run to see what would go
 *
 * Stop `bun run dev` first: an API holding metadata.db open would recreate it under you. Only
 * paths inside the repository are removed; a TESTATE_DATA_DIR in `apps/api/.env` that points
 * elsewhere is printed and left alone, because this script cannot know what else lives there.
 */
import { existsSync, rmSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
if (!args.includes("--yes") && !dryRun) {
  throw new Error(
    "this wipes data; run with --yes (and --engines to reset the compose databases), or --dry-run"
  );
}

/** The data directory `bun run dev` uses: `apps/api/.env` if it names one, else apps/api/data. */
async function devDataDir(): Promise<string> {
  const env = join(ROOT, "apps/api/.env");
  const text = existsSync(env) ? await Bun.file(env).text() : "";
  const line = /^TESTATE_DATA_DIR=(.+)$/m.exec(text)?.[1]?.trim() ?? "";
  if (line === "") return join(ROOT, "apps/api/data");
  return isAbsolute(line) ? line : resolve(join(ROOT, "apps/api"), line);
}

const targets = [
  await devDataDir(),
  join(ROOT, ".e2e"),
  join(ROOT, ".smoke"),
  join(ROOT, ".bin-build"),
  join(ROOT, "apps/api/dist"),
  join(ROOT, "apps/web/dist"),
  join(ROOT, "slim.report.json"),
  join(ROOT, "profile.env"),
];

for (const target of targets) {
  const inside = !relative(ROOT, target).startsWith("..");
  if (!inside) {
    console.log(`left alone (outside the repository): ${target}`);
    continue;
  }
  if (!existsSync(target)) continue;
  if (dryRun) {
    console.log(`would remove ${relative(ROOT, target)}`);
    continue;
  }
  rmSync(target, { recursive: true, force: true });
  console.log(`removed ${relative(ROOT, target)}`);
}

if (args.includes("--engines") && !dryRun) {
  const compose = ["docker", "compose", "-f", join(ROOT, "deploy/compose.engines.yml")];
  for (const step of [
    [...compose, "down", "--volumes", "--remove-orphans"],
    [...compose, "up", "-d", "--wait"],
  ]) {
    const proc = Bun.spawn(step, { stdout: "inherit", stderr: "inherit" });
    const code = await proc.exited;
    if (code !== 0) throw new Error(`${step.slice(2).join(" ")} exited ${code}`);
  }
  console.log("compose engines recreated with empty volumes");
}

console.log("clean. Next: bun run dev, then TESTATE_ADMIN_PASSWORD=<bootstrap> bun run seed:dev");

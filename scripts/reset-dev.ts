/**
 * Wipes the development environment back to nothing: the API's data directory (metadata, blobs,
 * logs, uploads, the unpacked SPA), the suite's and smoke's scratch trees, both build outputs and
 * the compiled binaries. With `--engines` it also drops the compose databases, brings them up
 * fresh, creates the MinIO bucket, and runs the contract suites once, because those suites are
 * what create the demo tables the seed reads; a fresh engine holds an empty `shop`.
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
  const rel = relative(ROOT, target);
  const inside = rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  // A data directory holds no package.json and no repository; a path that does is the checkout
  // itself or a workspace, whatever TESTATE_DATA_DIR says, and it is never removed from here.
  const isCode = existsSync(join(target, "package.json")) || existsSync(join(target, ".git"));
  if (!inside || isCode) {
    console.log(`left alone (not a data directory of this checkout): ${target}`);
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

/**
 * Runs a step with its output held back, printed only when the step fails; one line otherwise.
 * With `attempts` above one a failure is retried that many times before it is reported.
 */
async function step(label: string, command: string[], attempts = 1): Promise<string> {
  const proc = Bun.spawn(command, { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    if (attempts > 1) return step(label, command, attempts - 1);
    process.stdout.write(out + err);
    throw new Error(`${label}: ${command.slice(0, 2).join(" ")} exited ${code}`);
  }
  console.log(label);
  return out;
}

if (args.includes("--engines") && !dryRun) {
  const compose = ["docker", "compose", "-f", join(ROOT, "deploy/compose.engines.yml")];
  // `up --wait` fails on a container that exits, however cleanly, and the bucket creation is
  // a one-shot: it is left out of the wait and run on its own afterwards, as CI does.
  const services = (await step("compose services listed", [...compose, "config", "--services"]))
    .split("\n")
    .filter((name) => name !== "" && name !== "minio-init");
  await step("engines dropped with their volumes", [
    ...compose,
    "down",
    "--volumes",
    "--remove-orphans",
  ]);
  // The ftp image's first start often dies and Docker restarts it, and `--wait` counts that
  // restart as a failure although the container is healthy a moment later. A second wait on the
  // running stack answers in seconds, which is what CI does too.
  await step(
    "engines up and healthy",
    [...compose, "up", "-d", "--wait", "--quiet-pull", ...services],
    2
  );
  await step("MinIO bucket created", [...compose, "run", "--rm", "minio-init"]);
  await step("demo schema created by the contract suites", ["bun", "run", "contract"]);
}

console.log("clean. Next: bun run seed:dev, then bun run dev");

/**
 * Runs every contract suite against `deploy/compose.engines.yml`.
 *
 * Each suite skips itself when its target is unreachable, which is right on a laptop with no
 * Docker and wrong in CI: a skipped run and a green run look identical. So this script fails on a
 * skip. That is the whole reason it exists.
 *
 *   docker compose -f deploy/compose.engines.yml up -d --wait
 *   docker compose -f deploy/compose.engines.yml run --rm minio-init
 *   bun run contract
 */
import { Glob } from "bun";

const ROOT = new URL("..", import.meta.url).pathname;

const compose = Bun.file(`${ROOT}deploy/compose.engines.yml`);
if (!(await compose.exists())) throw new Error("deploy/compose.engines.yml is missing");

const suites = [...new Glob("apps/api/src/**/*.contract.test.ts").scanSync(ROOT)].sort();
if (suites.length === 0) throw new Error("no contract suites found under apps/api/src");
console.log(`contract suites:\n  ${suites.join("\n  ")}\n`);

const run = Bun.spawnSync(["bun", "test", ...suites], {
  cwd: ROOT,
  stderr: "pipe",
  stdout: "pipe",
});
const output = new TextDecoder().decode(run.stderr) + new TextDecoder().decode(run.stdout);
process.stdout.write(output);

/** Bun prints one summary line per outcome: " 26 pass", " 3 skip", " 0 fail". */
function counted(word: string): number {
  const found = new RegExp(`^\\s*(\\d+) ${word}`, "m").exec(output);
  return Number(found?.[1] ?? 0);
}

if (run.exitCode !== 0) process.exit(run.exitCode ?? 1);

const skipped = counted("skip");
if (skipped > 0) {
  console.error(
    `\n${skipped} contract test(s) skipped: a target is unreachable, so this proves nothing.\n` +
      "Start the engines first:\n" +
      "  docker compose -f deploy/compose.engines.yml up -d --wait\n" +
      "  docker compose -f deploy/compose.engines.yml run --rm minio-init"
  );
  process.exit(1);
}

const passed = counted("pass");
if (passed === 0) {
  console.error("\nno contract test ran at all");
  process.exit(1);
}
console.log(`\n${passed} contract tests ran against the compose engines, none skipped`);

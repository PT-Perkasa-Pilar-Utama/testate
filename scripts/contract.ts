// Runs the engine and file contract suites against deploy/compose.engines.yml.
// Sprint 0: the suites land with the engine cards; this script only checks the compose file exists.
const compose = Bun.file(new URL("../deploy/compose.engines.yml", import.meta.url));
if (!(await compose.exists())) {
  throw new Error("deploy/compose.engines.yml is missing");
}
console.log("contract suites: none registered yet (Sprint 0)");

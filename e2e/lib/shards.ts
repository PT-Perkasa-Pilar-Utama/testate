/**
 * The browser suite's projects, and the CI shards that split them (#40).
 *
 * Plain data with no runtime import, so `shard-key.ts` can read it with bare Bun before a single
 * package is installed. `playwright.config.ts` takes its projects from `projectsFor`.
 */

export type ProjectSpec = { name: string; testMatch: RegExp; dependencies?: string[] };

export const PROJECTS: ProjectSpec[] = [
  { name: "coverage", testMatch: /coverage\.e2e\.ts/ },
  { name: "routes", testMatch: /routes\.e2e\.ts/ },
  // Contract and agent stories talk to the API only; nothing they touch is shared state.
  // Anchored: `(api|agent)\.e2e\.ts` also matched `state-api.e2e.ts`, which then ran a second
  // time here, in the first phase, taking states and checking them out beside the UI stories.
  { name: "api", testMatch: /\/(api|agent)\.e2e\.ts$/ },
  // Sorting and searching, before any spec adds accounts the counts here would not expect.
  { name: "tables", testMatch: /tables\.e2e\.ts/, dependencies: ["routes"] },
  {
    name: "flows",
    testMatch: /(flows|stories|gaps|admin|jobs|viewer|stores)\.e2e\.ts/,
    dependencies: ["routes"],
  },
  // Checkouts restore the demo databases; nothing else may edit them meanwhile.
  { name: "states", testMatch: /states(-viewer)?\.e2e\.ts/, dependencies: ["flows"] },
  // The API-only state stories hold the same adapters; they run between the two UI phases.
  { name: "state-api", testMatch: /state-api\.e2e\.ts/, dependencies: ["states"] },
  { name: "adapter", testMatch: /adapter\.e2e\.ts/, dependencies: ["state-api"] },
  // The crawler submits every dialog it finds; it runs after the assertions that read seeded state.
  { name: "crawl", testMatch: /buttons\.e2e\.ts/, dependencies: ["adapter"] },
  // README screenshots, skipped unless SHOTS=1; it reads the seeded demo like any other spec.
  { name: "screens", testMatch: /screens\.e2e\.ts/, dependencies: ["state-api"] },
  // The reactive-loop hunt: skipped unless STRESS=1, and it wants the data a full run leaves.
  { name: "stress", testMatch: /stress\.e2e\.ts/, dependencies: ["state-api"] },
  // Playwright runs projects in phases: a project starts when every project of the phase before
  // it has finished, not only the ones it depends on. These two used to sit in the crawl's
  // previous phase, and their 45 seconds held the crawl at the gate. They run beside boot now.
  // The only spec that drives the built bundle; the rest drive Vite, and a reactive loop can
  // exist in one and not the other. It reads the seeded demo, so it waits for the UI phases.
  { name: "bundle", testMatch: /bundle\.e2e\.ts/, dependencies: ["crawl"] },
  // Boot stories spawn API processes of their own; run them last so they never starve a crawl.
  {
    name: "boot",
    testMatch: /(boot|engine|types|session|storage)\.e2e\.ts/,
    dependencies: ["crawl"],
  },
];

/**
 * Each shard is one CI job on its own runner, with its own engines and a fresh instance, so the
 * shared state that forces the chain above only has to be ordered inside a shard. A dependency on
 * a project in another shard stands for that project's own place in the chain, so it becomes the
 * nearest projects before it that are in the shard (none, at the head of the chain).
 */
export const SHARDS = {
  screens: ["coverage", "routes", "api", "tables"],
  flows: ["flows"],
  // boot follows adapter here rather than the crawl: it reads nothing the crawl leaves, and the
  // crawl alone is the longest project in the suite.
  states: ["states", "state-api", "adapter", "boot"],
  tail: ["crawl", "screens", "stress"],
  // The one shard on the production build (`spaFor`): the walk that catches a loop the dev build
  // does not show.
  bundle: ["bundle"],
} as const satisfies Record<string, readonly string[]>;

export type Shard = keyof typeof SHARDS;

/**
 * Which build of the SPA a shard drives. Every spec but the bundle walk runs on Solid's dev build,
 * bundled once and served by the API, so its diagnostics stay on; the Vite dev server is gone from
 * the suite (#40, #49). The bundle walk needs the production build, the one users get.
 */
export function spaFor(shard: string | undefined): "development" | "production" {
  return shard === "bundle" ? "production" : "development";
}

export function isShard(name: string): name is Shard {
  return Object.hasOwn(SHARDS, name);
}

/** The projects in the shard that `name` waits for, directly or through projects outside it. */
function nearestInShard(name: string, inShard: ReadonlySet<string>): string[] {
  const project = PROJECTS.find((one) => one.name === name);
  return (project?.dependencies ?? []).flatMap((dependency) =>
    inShard.has(dependency) ? [dependency] : nearestInShard(dependency, inShard)
  );
}

/** Every project for a full run, or one shard's projects with the chain order kept inside it. */
export function projectsFor(shard: string | undefined): ProjectSpec[] {
  if (shard === undefined || shard === "") return PROJECTS;
  if (!isShard(shard))
    throw new Error(`E2E_SHARD=${shard} is not one of ${Object.keys(SHARDS).join(", ")}`);
  const inShard = new Set<string>(SHARDS[shard]);
  return PROJECTS.filter((project) => inShard.has(project.name)).map((project) => ({
    ...project,
    dependencies: [...new Set(nearestInShard(project.name, inShard))],
  }));
}
const SPEC = /^e2e\/[^/]+\.e2e\.ts$/;

/** The shards whose projects run a spec file, by its path from the repository root. */
export function shardsOfSpec(path: string): Shard[] {
  const projects = new Set(
    PROJECTS.filter((project) => project.testMatch.test(`/${path}`)).map((project) => project.name)
  );
  return Object.keys(SHARDS)
    .filter(isShard)
    .filter((shard) => SHARDS[shard].some((name) => projects.has(name)));
}

/**
 * The tracked files a shard's result depends on: everything but the documentation and the specs
 * only other shards run. A change to one of them runs the shard again; anything else reuses a pass.
 */
export function inputsOf(shard: Shard, tracked: readonly string[]): string[] {
  return tracked.filter((path) => {
    if (path.startsWith("docs/") || path.endsWith(".md")) return false;
    if (!SPEC.test(path)) return true;
    return shardsOfSpec(path).includes(shard);
  });
}

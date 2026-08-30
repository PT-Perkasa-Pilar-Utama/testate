/**
 * Writes one version everywhere it is written down: the four `package.json` files and the constant
 * the API reports. The root `package.json` is the source of truth — `deploy-image.yml` tags the
 * published image with it, and the Dockerfile stamps it into `org.opencontainers.image.version`.
 *
 *   bun run bump-version 1.0.0-alpha   # write it
 *   bun run bump-version --check       # exit 1 if the files disagree
 */
const ROOT = new URL("..", import.meta.url).pathname;

const MANIFESTS = [
  "package.json",
  "apps/api/package.json",
  "apps/web/package.json",
  "packages/shared/package.json",
];
const CONSTANT = "apps/api/src/version.ts";

/** Semver with an optional pre-release, which is what the image tag and the API report. */
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const FIRST_VERSION = /"version": "([^"]+)"/;
const VERSION_CONSTANT = /export const VERSION = "([^"]+)";/;

type Slot = { file: string; pattern: RegExp; render: (version: string) => string };

const SLOTS: Slot[] = [
  ...MANIFESTS.map((file) => ({
    file,
    pattern: FIRST_VERSION,
    render: (version: string) => `"version": "${version}"`,
  })),
  {
    file: CONSTANT,
    pattern: VERSION_CONSTANT,
    render: (version: string) => `export const VERSION = "${version}";`,
  },
];

async function read(slot: Slot): Promise<{ text: string; version: string }> {
  const text = await Bun.file(`${ROOT}${slot.file}`).text();
  const found = slot.pattern.exec(text);
  if (found?.[1] === undefined) throw new Error(`${slot.file}: no version to read`);
  return { text, version: found[1] };
}

async function check(): Promise<number> {
  const slots = await Promise.all(SLOTS.map(async (slot) => ({ slot, ...(await read(slot)) })));
  const root = slots[0]?.version ?? "";
  const adrift = slots.filter((item) => item.version !== root);
  for (const item of adrift) console.error(`${item.slot.file}: ${item.version}, want ${root}`);
  if (adrift.length > 0) return 1;
  console.log(`version ${root} in ${slots.length} files`);
  return 0;
}

async function write(version: string): Promise<number> {
  if (!SEMVER.test(version)) throw new Error(`not a version: ${version}`);
  for (const slot of SLOTS) {
    const { text, version: before } = await read(slot);
    await Bun.write(`${ROOT}${slot.file}`, text.replace(slot.pattern, slot.render(version)));
    console.log(`${slot.file}: ${before} -> ${version}`);
  }
  console.log("commit these, then tag the release; the image takes its tag from package.json");
  return 0;
}

const argument = process.argv[2] ?? "";
if (argument === "") throw new Error("usage: bun run bump-version <version> | --check");
process.exit(argument === "--check" ? await check() : await write(argument));

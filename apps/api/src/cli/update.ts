/**
 * `testate update`: the latest release, checked against its `checksums.txt`, swapped in for this
 * binary, and the per-user service restarted (docs/decisions/2026-10-10-cli.md, Q2). It is the
 * only code in the binary that reaches the network, and only when a person runs it.
 */
import {
  accessSync,
  chmodSync,
  constants,
  copyFileSync,
  mkdtempSync,
  renameSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";

import { CliError, say, usage } from "./io.ts";
import type { CliContext } from "./io.ts";
import type { Os } from "./paths.ts";
import { restartService, serviceDeps } from "./service.ts";
import type { Runner, ServiceDeps } from "./service.ts";

/** Always HTTPS in the field; only a test passes another base (decision Q2b). */
export const RELEASES = "https://github.com/PT-Perkasa-Pilar-Utama/testate/releases";

export type UpdateDeps = {
  base: string;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  binary: string | null;
  os: Os;
  arch: string;
  run: Runner;
  service: ServiceDeps;
};

/** `2.0.10` is newer than `2.0.9`; `2.0.0-rc.1` is older than `2.0.0`. */
export function newer(candidate: string, current: string): boolean {
  const parts = (version: string): number[] => {
    const [core = "", pre] = version.split("-");
    return [...core.split(".").map(Number), pre === undefined ? 1 : 0];
  };
  const a = parts(candidate);
  const b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

/**
 * The latest version, from where GitHub's "latest" link redirects, with no API call and so no
 * rate limit. `docs/install.sh` resolves "latest" the same way; change both together.
 */
export async function latestVersion(deps: UpdateDeps): Promise<string> {
  const response = await deps.fetch(`${deps.base}/latest`, { redirect: "manual" });
  const tag = /\/tag\/v([^/]+)$/.exec(response.headers.get("location") ?? "")?.[1];
  if (tag === undefined)
    throw new CliError(1, `could not find the latest release (HTTP ${response.status})`);
  return tag;
}

export function archiveName(os: Os, arch: string): string {
  const goArch = arch === "x64" ? "amd64" : arch;
  if (goArch !== "amd64" && goArch !== "arm64") throw new CliError(1, `no release for ${arch}`);
  return os === "win32" ? `testate_windows_${goArch}.zip` : `testate_${os}_${goArch}.tar.gz`;
}

/** Refusals that need no download: not the binary, Homebrew's, or a folder it may not write. */
export function refusal(binary: string | null): string | null {
  if (binary === null)
    return "update works on the standalone testate binary; update the image or the checkout instead";
  if (binary.includes("/Cellar/"))
    return "this testate came from Homebrew; run brew upgrade testate";
  try {
    accessSync(dirname(binary), constants.W_OK);
    return null;
  } catch {
    return `cannot write ${dirname(binary)}; run testate update as the user who owns ${binary}`;
  }
}

async function bytes(deps: UpdateDeps, url: string): Promise<Uint8Array> {
  const response = await deps.fetch(url);
  if (!response.ok) throw new CliError(1, `could not download ${url} (HTTP ${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Downloads the archive and checks it against the release's checksums.txt. */
async function verifiedArchive(
  deps: UpdateDeps,
  version: string,
  name: string
): Promise<Uint8Array> {
  const release = `${deps.base}/download/v${version}`;
  const sums = new TextDecoder().decode(await bytes(deps, `${release}/checksums.txt`));
  const expected = sums
    .split("\n")
    .find((line) => line.endsWith(`  ${name}`))
    ?.split(" ")[0];
  if (expected === undefined) throw new CliError(1, `checksums.txt does not list ${name}`);
  const archive = await bytes(deps, `${release}/${name}`);
  const actual = new Bun.CryptoHasher("sha256").update(archive).digest("hex");
  if (actual !== expected)
    throw new CliError(1, `${name} does not match checksums.txt; nothing was changed`);
  return archive;
}

/** Unpacks next to the binary as `.new`, and keeps it only if it runs and names the version. */
async function staged(deps: UpdateDeps, archive: Uint8Array, name: string, version: string) {
  const work = mkdtempSync(join(tmpdir(), "testate-update-"));
  try {
    await Bun.write(join(work, name), archive);
    const unpack = deps.run(["tar", "-xf", join(work, name), "-C", work]);
    if (unpack.code !== 0) throw new CliError(1, `could not unpack ${name}: ${unpack.err.trim()}`);
    const binary = deps.binary ?? "";
    const next = `${binary}.new`;
    copyFileSync(join(work, deps.os === "win32" ? "testate.exe" : "testate"), next);
    chmodSync(next, 0o755);
    const answer = deps.run([next, "--version"]).out.trim();
    if (answer !== `testate ${version}`) {
      rmSync(next, { force: true });
      throw new CliError(
        1,
        `the new binary does not run here (it answered "${answer}"); nothing was changed`
      );
    }
    return next;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Windows will not overwrite a running .exe but will rename it, so the old one steps aside. */
function swap(deps: UpdateDeps, next: string): void {
  const binary = deps.binary ?? "";
  if (deps.os === "win32") renameSync(binary, `${binary}.old`);
  renameSync(next, binary);
}

export async function updateWith(ctx: CliContext, deps: UpdateDeps): Promise<void> {
  const { values } = usage(() =>
    parseArgs({ args: ctx.args, options: { check: { type: "boolean" } }, strict: true })
  );
  const refused = values.check === true ? null : refusal(deps.binary);
  if (refused !== null) throw new CliError(1, refused);
  const latest = await latestVersion(deps);
  if (!newer(latest, ctx.version)) return say(`testate ${ctx.version} is the latest release.`);
  if (values.check === true)
    return say(`testate ${latest} is out (you have ${ctx.version}). Run testate update.`);
  const name = archiveName(deps.os, deps.arch);
  say(`Downloading ${name} for ${latest}`);
  swap(deps, await staged(deps, await verifiedArchive(deps, latest, name), name, latest));
  const restarted = restartService(deps.service, ctx.env);
  say(
    `Updated to testate ${latest}. ${restarted ? "The service restarted on it." : "Restart testate to use it."}`
  );
}

export async function update(ctx: CliContext): Promise<void> {
  const service = serviceDeps();
  return updateWith(ctx, {
    base: RELEASES,
    fetch: (url, init) => fetch(url, init),
    binary: service.binary,
    os: service.os,
    arch: process.arch,
    run: service.run,
    service,
  });
}

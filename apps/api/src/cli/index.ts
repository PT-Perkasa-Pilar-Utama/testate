/**
 * The binary's command line (docs/decisions/2026-10-10-cli.md). A bare `testate` starts the
 * server, as the container, the systemd unit and the pm2 file expect; every other command manages
 * this machine's install and exits. Spec 22 §22.2: the command is chosen before boot step 0.
 */
import { parseArgs } from "node:util";

import type { App } from "../index.ts";
import { CliError, say, usage } from "./io.ts";
import type { CliContext } from "./io.ts";
import { service } from "./service.ts";
import { setup } from "./setup.ts";
import { update } from "./update.ts";
import { whereis } from "./whereis.ts";
import { refuse, serve } from "../boot.ts";
import { readEnvFile, withEnvFile } from "./envfile.ts";
import type { EnvValues } from "./envfile.ts";
import { currentOs, defaultEnvFile } from "./paths.ts";
import type { Env } from "./paths.ts";

type Command = { usage: string; summary: string; run: (ctx: CliContext) => Promise<void> };

/** The env file `start` reads: `--env-file`, else the default one when it exists (Q3). */
export function envFileFor(flag: string | undefined, env: Env): EnvValues | null {
  const path = flag ?? defaultEnvFile(env, currentOs());
  const file = path === null ? null : readEnvFile(path);
  if (flag !== undefined && file === null) throw new CliError(1, `no env file at ${flag}`);
  return file;
}

async function start(ctx: CliContext): Promise<void> {
  const { values } = usage(() =>
    parseArgs({ args: ctx.args, options: { "env-file": { type: "string" } }, strict: true })
  );
  const file = envFileFor(values["env-file"], ctx.env);
  let app: App;
  try {
    app = await ctx.boot(withEnvFile(ctx.env, file));
  } catch (cause: unknown) {
    refuse(cause);
  }
  serve(app);
}

async function version(ctx: CliContext): Promise<void> {
  say(`testate ${ctx.version}`);
}

const COMMANDS = new Map<string, Command>([
  [
    "start",
    { usage: "start [--env-file <path>]", summary: "Run the server (the default)", run: start },
  ],
  [
    "setup",
    {
      usage: "setup [--yes] [--env-file <path>] [--data-dir <dir>] [--port <n>]",
      summary: "Write testate.env: data directory, port, sealing key, first admin",
      run: setup,
    },
  ],
  [
    "service",
    {
      usage: "service install|start|stop|status|logs [-f]|uninstall",
      summary: "Keep it running as a per-user service (Linux, macOS)",
      run: service,
    },
  ],
  [
    "update",
    {
      usage: "update [--check]",
      summary: "Install the latest release, verified, and restart the service",
      run: update,
    },
  ],
  [
    "whereis",
    {
      usage: "whereis [env|data|bin|service|log|ingest]",
      summary: "Show where this install keeps things",
      run: whereis,
    },
  ],
  ["version", { usage: "version", summary: "Print the version", run: version }],
]);

const ALIASES = new Map([
  ["--version", "version"],
  ["-v", "version"],
]);

export function helpText(): string {
  const commands = [...COMMANDS.values()];
  const width = Math.max(...commands.map((command) => command.usage.length));
  const rows = commands.map(
    (command) => `  testate ${command.usage.padEnd(width)}  ${command.summary}`
  );
  return ["Usage:", ...rows, "", "Docs: https://github.com/PT-Perkasa-Pilar-Utama/testate"].join(
    "\n"
  );
}

async function dispatch(args: string[], ctx: Omit<CliContext, "args">): Promise<void> {
  const [word, ...rest] = args;
  if (word === undefined || word.startsWith("--env-file")) return start({ ...ctx, args });
  if (word === "help" || word === "--help" || word === "-h") return say(helpText());
  const command = COMMANDS.get(ALIASES.get(word) ?? word);
  if (command === undefined) throw new CliError(2, `unknown command "${word}"\n\n${helpText()}`);
  return command.run({ ...ctx, args: rest });
}

/** The entry point: `args` are the words after the program name, `Bun.argv.slice(2)`. */
export async function run(args: string[], ctx: Omit<CliContext, "args">): Promise<void> {
  try {
    await dispatch(args, ctx);
  } catch (cause: unknown) {
    // Any other failure (a folder it may not write, a port in use) is one line too, not a
    // stack trace through minified code.
    const message = cause instanceof Error ? cause.message : String(cause);
    process.stderr.write(`testate: ${message}\n`);
    process.exitCode = cause instanceof CliError ? cause.exitCode : 1;
  }
}

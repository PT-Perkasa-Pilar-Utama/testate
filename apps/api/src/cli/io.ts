/** What every command shares: its context, its refusals and its output. */
import type { App } from "../index.ts";
import type { Env } from "./paths.ts";

export type CliContext = {
  /** The arguments after the command word. */
  args: string[];
  env: Env;
  version: string;
  boot: (env: Env) => Promise<App>;
};

/** A refusal the CLI reports as one line on stderr, with its own exit code. */
export class CliError extends Error {
  constructor(
    readonly exitCode: number,
    message: string
  ) {
    super(message);
  }
}

export function say(text: string): void {
  process.stdout.write(`${text}\n`);
}

/** Runs a `util.parseArgs` call; an unknown or malformed option becomes a usage error (exit 2). */
export function usage<T>(parse: () => T): T {
  try {
    return parse();
  } catch (cause: unknown) {
    throw new CliError(2, cause instanceof Error ? cause.message : String(cause));
  }
}

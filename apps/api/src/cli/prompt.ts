/**
 * Questions on a terminal. `node:readline/promises` asks the plain ones; a password is read in
 * raw mode so nothing echoes, which readline cannot do (docs/decisions/2026-10-10-cli.md).
 */
import { createInterface } from "node:readline/promises";

/** True when a person can answer: both ends of the conversation are a terminal. */
export function interactive(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

/** Asks once; an empty answer takes the default shown in brackets. */
export async function ask(question: string, fallback: string): Promise<string> {
  const lines = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await lines.question(`${question} [${fallback}]: `)).trim();
    return answer === "" ? fallback : answer;
  } finally {
    lines.close();
  }
}

const ENTER = new Set(["\r", "\n"]);
const BACKSPACE = new Set(["\u007f", "\b"]);
const CTRL_C = "\u0003";

/** What one keypress does to the typed text; null once Enter ends the line. */
function typed(text: string, key: string): string | null {
  if (ENTER.has(key)) return null;
  if (key === CTRL_C) {
    process.stdin.setRawMode(false);
    process.stdout.write("\n");
    process.exit(130);
  }
  if (BACKSPACE.has(key)) return text.slice(0, -1);
  return text + key;
}

/**
 * Reads one line with nothing echoed, and restores the terminal however it ends. A `data` listener,
 * not `for await`: once readline has closed stdin, Bun's async iterator never yields again.
 */
export function secret(question: string): Promise<string> {
  process.stdout.write(`${question}: `);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve) => {
    let text = "";
    const onData = (chunk: Buffer): void => {
      for (const key of chunk.toString("utf8")) {
        const next = typed(text, key);
        if (next === null) {
          process.stdin.off("data", onData);
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write("\n");
          resolve(text);
          return;
        }
        text = next;
      }
    };
    process.stdin.on("data", onData);
  });
}

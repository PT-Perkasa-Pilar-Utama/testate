/**
 * A Chrome DevTools Protocol client on Bun's WebSocket: launch, attach to a page, send commands,
 * subscribe to events. No dependency; Chrome's `--remote-debugging-port` is the whole contract.
 */
import * as v from "valibot";
import type { JsonObject } from "@testate/shared";
import { jsonValueSchema } from "@testate/shared";

const CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

const message = v.object({
  id: v.optional(v.number()),
  method: v.optional(v.string()),
  params: v.optional(v.record(v.string(), jsonValueSchema)),
  result: v.optional(v.record(v.string(), jsonValueSchema)),
  error: v.optional(v.object({ message: v.string() })),
});

const target = v.object({ id: v.string(), type: v.string(), webSocketDebuggerUrl: v.string() });

export type Params = JsonObject;
export type Result = JsonObject;

export type Chrome = { port: number; close: () => void };

export async function launchChrome(port: number, userDataDir: string): Promise<Chrome> {
  const binary = CHROME_PATHS.find(
    (path) => Bun.file(path).size > 0 || path.startsWith("/Applications")
  );
  if (binary === undefined) throw new Error("no Chrome binary found");
  const child = Bun.spawn(
    [
      binary,
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1440,1000",
      "about:blank",
    ],
    { stdout: "ignore", stderr: "ignore" }
  );
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return { port, close: () => child.kill() };
    } catch {
      await Bun.sleep(100);
    }
  }
  child.kill();
  throw new Error("Chrome did not open its debugging port");
}

export type Page = {
  send: (method: string, params?: Params) => Promise<Result>;
  on: (method: string, handler: (params: Params) => void) => void;
  close: () => void;
};

/** Opens a new tab and attaches to it; events arrive on `on`, commands go through `send`. */
export async function openPage(port: number): Promise<Page> {
  const created = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
  const info = v.parse(target, await created.json());
  const socket = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve());
    socket.addEventListener("error", () => reject(new Error("CDP socket failed")));
  });
  let nextId = 1;
  const pending = new Map<number, { resolve: (r: Result) => void; reject: (e: Error) => void }>();
  const handlers = new Map<string, ((params: Params) => void)[]>();
  socket.addEventListener("message", (event) => {
    const parsed = v.safeParse(message, JSON.parse(String(event.data)));
    if (!parsed.success) return;
    const item = parsed.output;
    if (item.id !== undefined) {
      const waiter = pending.get(item.id);
      pending.delete(item.id);
      if (waiter === undefined) return;
      if (item.error !== undefined) waiter.reject(new Error(item.error.message));
      else waiter.resolve(item.result ?? {});
      return;
    }
    if (item.method !== undefined)
      for (const handler of handlers.get(item.method) ?? []) handler(item.params ?? {});
  });
  return {
    send: (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = nextId;
        nextId += 1;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      }),
    on: (method, handler) => handlers.set(method, [...(handlers.get(method) ?? []), handler]),
    close: () => socket.close(),
  };
}

/** Evaluates an expression in the page and returns its JSON value (awaits promises). */
export async function evaluate<T>(
  page: Page,
  expression: string,
  schema: v.GenericSchema<unknown, T>
): Promise<T> {
  const result = await page.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  const parsed = v.parse(
    v.object({
      result: v.object({ value: v.optional(jsonValueSchema) }),
      exceptionDetails: v.optional(v.object({ text: v.string() })),
    }),
    result
  );
  if (parsed.exceptionDetails !== undefined)
    throw new Error(
      `evaluate failed: ${parsed.exceptionDetails.text} in ${expression.slice(0, 80)}`
    );
  return v.parse(schema, parsed.result.value);
}

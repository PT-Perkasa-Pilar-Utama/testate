import { Glob } from "bun";
import { expect, test } from "bun:test";
import { resolve } from "node:path";

import { reachable } from "./graph.ts";

const SRC = resolve(import.meta.dir, "../src");

/**
 * `bun test` transpiles JSX with the React runtime, because the repo root has no tsconfig, and
 * `@solidjs/web` ships no `jsxDEV`. So a `.tsx` in a test's import graph fails CI on a clean
 * install, however green it looks on a machine whose node_modules happens to hold React.
 */
test("no web test reaches a .tsx file", () => {
  const tests = [...new Glob("**/*.test.ts").scanSync(SRC)].map((name) => resolve(SRC, name));
  expect(tests.length).toBeGreaterThan(0);
  expect(reachable(tests).filter((file) => file.endsWith(".tsx"))).toEqual([]);
});

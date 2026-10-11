/** Boots the API in the page and fills it (#demo); `main.ts` reaches it as `@demo/backend`. */
import { ADMIN, BASE_PATH, bootDemo } from "./boot.ts";
import type { StartDemo } from "./contract.ts";
import { ACCOUNTS, seedDemo } from "./seed.ts";
import { startHostClock } from "./host-clock.ts";
import { APP_HOST, FILES_HOST, demoWorld } from "./world.ts";

export const startDemo: StartDemo = async () => {
  const world = demoWorld();
  const backend = await bootDemo(world);
  const app = world.trees.get(APP_HOST);
  const files = world.trees.get(FILES_HOST);
  if (app === undefined || files === undefined) throw new Error("the demo world has no hosts");
  // Before the seed: its first reading reads these files.
  startHostClock(
    [
      { tree: app, scale: 1, app: true },
      { tree: files, scale: 0.4, app: false },
    ],
    Date.now()
  );
  const shop = world.databases.get("shop");
  if (shop === undefined) throw new Error("the demo world has no shop database");
  await seedDemo(backend, shop);
  return { fetch: backend.fetch, basePath: BASE_PATH, admin: ADMIN, accounts: ACCOUNTS };
};

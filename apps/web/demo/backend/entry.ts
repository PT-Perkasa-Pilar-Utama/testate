/** Boots the API in the page and fills it (#demo); `main.ts` reaches it as `@demo/backend`. */
import { ADMIN, BASE_PATH, bootDemo } from "./boot.ts";
import type { StartDemo } from "./contract.ts";
import { ACCOUNTS, seedDemo } from "./seed.ts";
import { demoWorld } from "./world.ts";

export const startDemo: StartDemo = async () => {
  const world = demoWorld();
  const backend = await bootDemo(world);
  const shop = world.databases.get("shop");
  if (shop === undefined) throw new Error("the demo world has no shop database");
  await seedDemo(backend, shop);
  return { fetch: backend.fetch, basePath: BASE_PATH, admin: ADMIN, accounts: ACCOUNTS };
};

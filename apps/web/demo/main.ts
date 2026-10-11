/**
 * The demo's entry (#demo). Globals the API expects go in first, then sql.js, then the API boots
 * and seeds in this page, then the SPA loads unchanged and talks to it through `network.ts`.
 * Everything after the globals is a dynamic import, so no API module runs before they exist.
 */
import { Buffer } from "./shims/buffer.ts";
import initSqlJs from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm-browser.wasm?url";

import { showBanner } from "./banner.ts";
import { demoBun } from "./shims/bun-global.ts";
import { useSqlite } from "./shims/sqlite.ts";

// The API calls only the `Bun` and `Buffer` members `bun-global.ts` and `buffer.ts` provide.
Object.assign(globalThis, { Buffer, Bun: demoBun, process: { env: {} } });
useSqlite(await initSqlJs({ locateFile: () => wasmUrl }));

const { startDemo } = await import("@demo/backend");
const { installNetwork } = await import("./network.ts");

const demo = await startDemo();
const BASE_PATH = demo.basePath;
const api = `${BASE_PATH}/api/v1`;
installNetwork(demo, api);
await fetch(`${api}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Testate-Request": "1" },
  body: JSON.stringify(demo.admin),
});
// A deep link came through docs/404.html as `?route=`; put it back before the SPA reads the path.
const route = new URLSearchParams(location.search).get("route");
if (route?.startsWith(`${BASE_PATH}/`) === true) history.replaceState(null, "", route);
document.getElementById("demo-start")?.remove();
showBanner(demo.admin, demo.accounts);
await import("../src/main.tsx");

// Most links in the SPA are plain anchors: a server reloads the page for free, but here a reload
// starts a new demo. Clicks the SPA left alone go through its own router instead.
const { navigate } = await import("@/lib/router.ts");

const plainClick = (event: MouseEvent): boolean =>
  !event.defaultPrevented &&
  event.button === 0 &&
  !event.metaKey &&
  !event.ctrlKey &&
  !event.shiftKey &&
  !event.altKey;

/** The SPA path an anchor points at, or null when it leaves the app or downloads a file. */
function appPath(anchor: HTMLAnchorElement): string | null {
  if (anchor.target !== "" || anchor.hasAttribute("download")) return null;
  const url = new URL(anchor.href, location.href);
  const inside = url.origin === location.origin && url.pathname.startsWith(`${BASE_PATH}/`);
  if (!inside || url.pathname.startsWith(api)) return null;
  return `${url.pathname.slice(BASE_PATH.length)}${url.search}${url.hash}`;
}

document.addEventListener("click", (event) => {
  const anchor = event.target instanceof Element ? event.target.closest("a") : null;
  const path = anchor === null || !plainClick(event) ? null : appPath(anchor);
  if (path === null) return;
  event.preventDefault();
  navigate(path);
});

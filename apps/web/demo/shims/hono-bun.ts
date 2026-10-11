/** `hono/bun` for the demo (#demo): the caller is this page, and no static files are served. */
import { unavailable } from "./unavailable.ts";

type ConnInfo = { remote: { address: string } };

export const getConnInfo = (): ConnInfo => ({ remote: { address: "127.0.0.1" } });
export const serveStatic = (): never => unavailable("Serving files");

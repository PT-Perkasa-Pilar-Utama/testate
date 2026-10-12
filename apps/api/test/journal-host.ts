/**
 * A fake systemd host for the end-to-end suite (story 160): an SSH server that answers the one
 * `journalctl` command a `journald` adapter runs, from journal entries given on stdin. Playwright
 * runs under Node and cannot resolve `ssh2` from the repository root, so the suite spawns this
 * under Bun from here, where it resolves. Prints `{"port":N}` once listening; runs until killed.
 *
 *   echo '[{"__CURSOR":"s=1",...}]' | bun apps/api/test/journal-host.ts <user> <password>
 */
import type { AddressInfo } from "node:net";
import { Server, utils } from "ssh2";
import type { JsonObject } from "@testate/shared";
import { jsonObjectSchema } from "@testate/shared";
import * as v from "valibot";

const [user = "", password = ""] = process.argv.slice(2);
if (user === "" || password === "")
  throw new Error("usage: bun apps/api/test/journal-host.ts <user> <password>");

const entries: JsonObject[] = v.parse(
  v.array(jsonObjectSchema),
  JSON.parse(await Bun.stdin.text())
);

/** The quoted words of `journalCommand`'s line; its values are allow-listed, so none holds a quote. */
function argsOf(command: string): string[] {
  return [...command.matchAll(/'([^']*)'/g)].map((match) => match[1] ?? "");
}

/** What journalctl prints for the command: the units asked for, the last `-n`, oldest first. */
function answer(command: string): string {
  const args = argsOf(command);
  if (args[0] !== "journalctl") return "";
  // Follow asks for what came after the newest line shown; this journal never grows.
  if (args.some((arg) => arg.startsWith("--after-cursor="))) return "";
  const units = args.flatMap((arg, at) => (args[at - 1] === "-u" ? [arg] : []));
  const lines = Number(args[args.indexOf("-n") + 1] ?? "1");
  const kept = entries
    .filter((entry) => units.length === 0 || units.includes(String(entry["_SYSTEMD_UNIT"])))
    .slice(-lines);
  const ordered = args.includes("-r") ? kept.reverse() : kept;
  return ordered.map((entry) => `${JSON.stringify(entry)}\n`).join("");
}

const isInfo = (address: AddressInfo | string | null): address is AddressInfo =>
  address !== null && Object.hasOwn(Object(address), "port");

const keys = utils.generateKeyPairSync("ed25519");
const server = new Server({ hostKeys: [keys.private] }, (client) => {
  client.on("authentication", (context) => {
    if (context.method === "password" && context.username === user && context.password === password)
      return context.accept();
    context.reject(["password"]);
  });
  client.on("ready", () => {
    client.on("session", (acceptSession) => {
      acceptSession().on("exec", (acceptExec, _reject, info) => {
        const stream = acceptExec();
        stream.write(answer(info.command));
        stream.exit(0);
        stream.end();
      });
    });
  });
  // A client that drops mid-handshake (the adapter's probe closing) is not this server's failure.
  client.on("error", () => undefined);
});
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!isInfo(address)) throw new Error("the journal host has no TCP address");
  process.stdout.write(`${JSON.stringify({ port: address.port })}\n`);
});

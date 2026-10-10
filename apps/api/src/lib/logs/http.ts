/**
 * One HTTP door for the log engines that speak JSON over HTTP, Loki (#90) and Elasticsearch (#92):
 * the address netguard approved, pinned for `http` with the host's name kept, the host name kept
 * for `https` so TLS checks it, no redirect followed (a 302 would reach an address netguard never
 * checked), and the body read as a stream up to a ceiling.
 */
import { AppError } from "../http/index.ts";
import { pinHttpEndpoint } from "../netguard/index.ts";

export type HttpLogin =
  | { auth: "none" }
  | { auth: "basic"; user: string; password: string }
  | { auth: "bearer"; token: string }
  | { auth: "api_key"; key: string };

export type HttpTarget = {
  url: string;
  /** The address netguard approved for the URL's host. */
  address: string;
  port: number;
  login: HttpLogin;
  /** Headers the engine always sends, such as Loki's tenant. */
  headers?: [string, string][];
  /** A PEM CA for a cluster with its own certificate. */
  ca?: string | undefined;
};

export type HttpAnswer = { status: number; body: Buffer; capped: boolean };

export type HttpCall = { path: string; method: "GET" | "POST"; body?: string };

export type PinnedHttp = { send(call: HttpCall, capBytes: number): Promise<HttpAnswer> };

const REQUEST_TIMEOUT_MS = 30_000;

function authorization(login: HttpLogin): string | null {
  if (login.auth === "basic")
    return `Basic ${Buffer.from(`${login.user}:${login.password}`).toString("base64")}`;
  if (login.auth === "bearer") return `Bearer ${login.token}`;
  if (login.auth === "api_key") return `ApiKey ${login.key}`;
  return null;
}

type Body = { body: Buffer; capped: boolean };

/** The body up to `capBytes`, read as a stream so an over-large answer is never held whole. */
async function bodyOf(response: Response, capBytes: number): Promise<Body> {
  const parts: Buffer[] = [];
  let size = 0;
  const reader = response.body?.getReader();
  for (
    let chunk = await reader?.read();
    chunk !== undefined && !chunk.done;
    chunk = await reader?.read()
  ) {
    parts.push(Buffer.from(chunk.value));
    size += chunk.value.length;
    if (size >= capBytes) {
      await reader?.cancel();
      return { body: Buffer.concat(parts).subarray(0, capBytes), capped: true };
    }
  }
  return { body: Buffer.concat(parts), capped: false };
}

/** A certificate signed by a CA Testate was not given reads as that, with its fix. */
export function unanswered(name: string, host: string, cause: string): AppError {
  if (/self[- ]signed|unable to (get|verify)|certificate/i.test(cause))
    return new AppError(
      "ADAPTER_UNREACHABLE",
      `${name}'s certificate is not trusted: set the adapter's CA`,
      {
        reason: "certificate",
        where: host,
      }
    );
  return new AppError("ADAPTER_UNREACHABLE", `${name} did not answer: ${cause}`, { where: host });
}

/** `name` says who did not answer: "Loki", "Elasticsearch". */
export function createPinnedHttp(target: HttpTarget, name: string): PinnedHttp {
  const base = pinHttpEndpoint(target.url, target.address, target.port).replace(/\/+$/, "");
  const host = new URL(target.url).host;
  return {
    async send(call, capBytes) {
      const headers = new Headers({
        Accept: "application/json",
        ...Object.fromEntries(target.headers ?? []),
      });
      const auth = authorization(target.login);
      if (auth !== null) headers.set("Authorization", auth);
      if (call.body !== undefined) headers.set("Content-Type", "application/json");
      // A pinned http URL names the address; the virtual host still wants its name.
      if (!target.url.startsWith(base)) headers.set("Host", host);
      const init: BunFetchRequestInit = {
        method: call.method,
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      };
      if (call.body !== undefined) init.body = call.body;
      if (target.ca !== undefined) init.tls = { ca: target.ca };
      let response: Response;
      try {
        response = await fetch(`${base}${call.path}`, init);
      } catch (cause: unknown) {
        throw unanswered(name, host, String(cause));
      }
      return { status: response.status, ...(await bodyOf(response, capBytes)) };
    },
  };
}

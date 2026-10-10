/**
 * The channels a Docker call travels over (#88; K1 of docs/decisions/2026-10-10-docker.md): an
 * OpenSSH `streamlocal` channel to the host's socket, through journald's SSH login, or a TCP socket,
 * TLS unless the adapter says `http`. Each request opens its own channel and closes it.
 */
import net from "node:net";
import tls from "node:tls";
import type { Duplex } from "node:stream";

import { AppError } from "../../http/index.ts";
import { unreachable } from "../../files/index.ts";
import { createSshSession } from "../ssh.ts";
import type { SshLogin } from "../ssh.ts";
import { createDockerApi } from "./api.ts";
import type { DockerApi } from "./api.ts";

export type DockerConnection =
  | { transport: "ssh"; login: SshLogin; socketPath: string }
  | {
      transport: "tcp";
      host: string;
      /** The address netguard returned for this connection. */
      address: string;
      port: number;
      scheme: "https" | "http";
      cert?: string | undefined;
      key?: string | undefined;
      ca?: string | undefined;
    };

const CONNECT_TIMEOUT_MS = 15_000;

/** The SSH user may log in but not open the socket: the `docker` group (K6). */
export function dockerAccess(user: string, socketPath: string): AppError {
  return new AppError(
    "ADAPTER_UNREACHABLE",
    `${user} cannot open ${socketPath}: add it to the docker group, which is root on that host, or reach a read-only socket proxy over tcp`,
    { reason: "docker_access" }
  );
}

function overSsh(login: SshLogin, socketPath: string): DockerApi {
  const session = createSshSession(login);
  const open = async (): Promise<Duplex> => {
    const client = await session.client();
    return new Promise((resolve, reject) => {
      client.openssh_forwardOutStreamLocal(socketPath, (error, channel) => {
        if (error !== undefined) return reject(dockerAccess(login.user, socketPath));
        resolve(channel);
      });
    });
  };
  return createDockerApi(open, () => session.close());
}

function tcpSocket(connection: Extract<DockerConnection, { transport: "tcp" }>): net.Socket {
  if (connection.scheme === "http") return net.connect(connection.port, connection.address);
  return tls.connect({
    host: connection.address,
    port: connection.port,
    // A certificate names the host, not the address it resolved to; SNI takes no IP.
    servername: net.isIP(connection.host) === 0 ? connection.host : undefined,
    cert: connection.cert,
    key: connection.key,
    ca: connection.ca,
  });
}

function overTcp(connection: Extract<DockerConnection, { transport: "tcp" }>): DockerApi {
  const where = `${connection.host}:${connection.port}`;
  const ready = connection.scheme === "http" ? "connect" : "secureConnect";
  const open = (): Promise<Duplex> =>
    new Promise((resolve, reject) => {
      const socket = tcpSocket(connection);
      socket.setTimeout(CONNECT_TIMEOUT_MS, () => socket.destroy(new Error("timed out")));
      socket.once(ready, () => {
        socket.setTimeout(0);
        resolve(socket);
      });
      socket.once("error", (cause: Error) => reject(unreachable(cause, "docker", where)));
    });
  return createDockerApi(open, async () => undefined);
}

export function openDocker(connection: DockerConnection): DockerApi {
  return connection.transport === "ssh"
    ? overSsh(connection.login, connection.socketPath)
    : overTcp(connection);
}

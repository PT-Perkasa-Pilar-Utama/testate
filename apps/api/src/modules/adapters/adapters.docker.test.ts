import { describe, expect, it } from "bun:test";

import { validateDocker } from "./adapters.docker.ts";

// #88, K1 (docs/decisions/2026-10-10-docker.md): over SSH the SFTP login's secrets; over TCP only
// a client key, and only with its certificate over https.
const SOURCES = [{ name: "api", container: "shop-api-1" }];
const SSH = { transport: "ssh", host: "app.sit.internal", user: "deploy", sources: SOURCES };
const TCP = { transport: "tcp", host: "docker.sit.internal", sources: SOURCES };
const CERT = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";

describe("a docker adapter's config", () => {
  it("takes the SSH login on port 22 and the Engine API's TLS port 2376 by default", () => {
    const ssh = validateDocker(SSH, { password: "x" });
    const tcp = validateDocker(TCP, {});
    expect([ssh.target, ssh.config["socket_path"], tcp.target, tcp.config["scheme"]]).toEqual([
      { host: "app.sit.internal", port: 22 },
      "/var/run/docker.sock",
      { host: "docker.sit.internal", port: 2376 },
      "https",
    ]);
  });

  it("needs a password or a key over SSH", () => {
    expect(() => validateDocker(SSH, {})).toThrow(
      "exactly one of password, private_key is required for sftp"
    );
  });

  it("over TCP takes a client key only with its certificate, and only over https", () => {
    expect(() => validateDocker(TCP, { password: "x" })).toThrow(
      "secret password is not used by docker over tcp"
    );
    expect(() => validateDocker(TCP, { tls_key: "k" })).toThrow(
      "a client certificate and its key go together"
    );
    expect(() =>
      validateDocker({ ...TCP, scheme: "http", tls_cert: CERT }, { tls_key: "k" })
    ).toThrow("a client certificate needs https");
  });

  it("refuses a socket path that climbs out, saying why", async () => {
    const refusal = Promise.try(() =>
      validateDocker({ ...SSH, socket_path: "/var/../etc/shadow" }, { password: "x" })
    );
    await expect(refusal).rejects.toMatchObject({
      message: "config does not match the engine",
      details: { issues: ["socket_path: A socket path has no .."] },
    });
  });

  it("is a new target when the socket changes", () => {
    const one = validateDocker(SSH, { password: "x" }).targetHash;
    const two = validateDocker(
      { ...SSH, socket_path: "/run/user/1000/docker.sock" },
      { password: "x" }
    );
    expect(two.targetHash).not.toBe(one);
  });
});

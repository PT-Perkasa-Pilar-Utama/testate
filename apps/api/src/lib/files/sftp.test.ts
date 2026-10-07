import { describe, expect, it, mock } from "bun:test";
import SftpClient from "ssh2-sftp-client";

import { createSftpSource } from "./sftp.ts";
import type { SftpSourceConfig } from "./sftp.ts";

const CONFIG: SftpSourceConfig = {
  host: "files.example.test",
  port: 22,
  user: "test",
  password: "test-secret",
  root_path: "/exports",
  verifyHostKey: () => true,
};

describe("SFTP outbound address pinning", () => {
  it.each([
    ["192.0.2.8", { ...CONFIG, address: "192.0.2.8" }],
    ["2001:db8::8", { ...CONFIG, address: "2001:db8::8" }],
    ["files.example.test", CONFIG],
  ])("passes the configured SSH target %s to the driver", async (host, config) => {
    const client = new SftpClient();
    // Stop at the driver boundary: no DNS lookup or network connection occurs in this unit test.
    const connect = mock(async (_options: Parameters<SftpClient["connect"]>[0]) => {
      throw new Error("connection refused");
    });
    client.connect = connect;
    const source = createSftpSource(config, () => client);

    await expect(source.list("", { limit: 10 })).rejects.toMatchObject({
      code: "ADAPTER_UNREACHABLE",
      details: { code: "ssh", where: "files.example.test:22" },
    });

    expect(connect.mock.calls).toEqual([
      [
        expect.objectContaining({
          host,
          port: 22,
          username: "test",
          hostVerifier: expect.any(Function),
        }),
      ],
    ]);
  });
});

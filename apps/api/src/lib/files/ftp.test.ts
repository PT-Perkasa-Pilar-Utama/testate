import { describe, expect, it } from "bun:test";

import type { FtpClient } from "./ftp.ts";
import { createFtpSource } from "./ftp.ts";

describe("FTP outbound address pinning", () => {
  it("connects to the checked address while verifying FTPS against the hostname", async () => {
    const accesses: Parameters<FtpClient["access"]>[0][] = [];
    const client: FtpClient = {
      async access(options) {
        accesses.push(options);
      },
      closed: false,
      close() {},
      async list() {
        return [];
      },
      async size() {
        return 0;
      },
      async downloadTo() {},
      async ensureDir() {},
      async cd() {},
      async uploadFrom() {},
      async remove() {},
      async removeDir() {},
      async rename() {},
    };
    const source = createFtpSource(
      {
        host: "files.example.test",
        address: "192.0.2.8",
        port: 21,
        user: "test",
        password: "secret",
        root_path: "/exports",
        tls: true,
      },
      () => client
    );

    await source.list("");

    expect(accesses).toHaveLength(1);
    expect(accesses[0]).toMatchObject({
      host: "192.0.2.8",
      port: 21,
      secure: true,
      secureOptions: { host: "files.example.test" },
    });
  });
});

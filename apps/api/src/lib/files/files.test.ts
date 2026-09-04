import { describe, expect, test } from "bun:test";

import { joinPath, normalizePath, pageEntries, unreachable } from "./index.ts";
import { hostKeyOf } from "./sftp.ts";

describe("files", () => {
  test("normalizePath strips empty and dot segments and refuses ..", () => {
    expect(normalizePath("/a//b/./c/")).toBe("a/b/c");
    expect(normalizePath(undefined)).toBe("");
    expect(() => normalizePath("a/../b")).toThrow("path may not contain ..");
    expect(joinPath("/upload/", "a/b")).toBe("/upload/a/b");
    expect(joinPath("", "")).toBe("/");
  });

  test("pageEntries filters then pages by offset and refuses a bad cursor", () => {
    const entries = ["a", "b", "c"].map((name) => ({
      name,
      path: name,
      kind: "file" as const,
      size_bytes: 1,
      modified_at: null,
    }));
    expect(pageEntries(entries, { limit: 2 })).toMatchObject({ next_cursor: "2" });
    expect(pageEntries(entries, { limit: 2, cursor: "2" }).data.map((e) => e.name)).toEqual(["c"]);
    expect(pageEntries(entries, { limit: 2, q: "c" }).data.map((e) => e.name)).toEqual(["c"]);
    expect(() => pageEntries(entries, { limit: 2, cursor: "x" })).toThrow("invalid cursor");
  });

  test("hostKeyOf reads the key type from the SSH wire format and hashes the blob", () => {
    const type = "ssh-ed25519";
    const raw = new Uint8Array(4 + type.length + 3);
    new DataView(raw.buffer).setUint32(0, type.length);
    raw.set(new TextEncoder().encode(type), 4);
    const key = hostKeyOf(raw);
    expect(key.type).toBe(type);
    const expected = new Bun.CryptoHasher("sha256").update(raw).digest("base64").replace(/=+$/, "");
    expect(key.fingerprint).toBe(`SHA256:${expected}`);
  });
});

describe("unreachable", () => {
  test("words a socket failure from where the store is and what the socket said", () => {
    const refused = { code: "ConnectionRefused", message: "an unexpected error has occurred" };
    expect(unreachable(refused, "ConnectionRefused", "minio:9000").message).toBe(
      "minio:9000 refused the connection"
    );
    expect(
      unreachable(new Error("getaddrinfo ENOTFOUND files.internal"), "ssh", "files.internal:22")
        .message
    ).toBe("files.internal:22 does not resolve");
    expect(unreachable(new Error("530 Login incorrect"), "ftp_530", "ftp.local:21").message).toBe(
      "ftp.local:21: 530 Login incorrect"
    );
    expect(unreachable({ code: "Weird" }, undefined, "s3.local").message).toBe(
      "s3.local could not be reached (Weird)"
    );
  });
});

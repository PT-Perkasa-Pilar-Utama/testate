import type { AdapterDraft } from "@testate/shared";
import * as v from "valibot";

import { createMemorySource } from "../src/lib/files/index.ts";
import type { MemoryTree } from "../src/lib/files/index.ts";
import type { OpenFileSource } from "../src/lib/files/open.ts";
import { AppError } from "../src/lib/http/index.ts";

export const SFTP: AdapterDraft = {
  kind: "storage",
  engine: "sftp",
  name: "drop",
  mode: "read_only",
  config: { host: "sftp.sit.internal", user: "testate", root_path: "/upload" },
  secrets: { password: "sftp-secret" },
};

/** Storage engines over memory trees; SFTP presents `sftpKey` so host-key trust has a path. */
export function memoryOpen(
  trees: Map<string, MemoryTree>,
  sftpKey: { current: string }
): OpenFileSource {
  return (engine, config, _secrets, verifyHostKey) => {
    const name = v.parse(v.string(), engine === "s3" ? config["bucket"] : config["host"]);
    let tree = trees.get(name);
    if (tree === undefined) {
      tree = new Map();
      trees.set(name, tree);
    }
    const source = createMemorySource(tree);
    if (engine !== "sftp") return source;
    const guard = async <T>(run: () => Promise<T>): Promise<T> => {
      const key = { type: "ssh-ed25519", fingerprint: sftpKey.current };
      if (!verifyHostKey(key))
        throw new AppError("CONFLICT", "the SFTP host key changed", {
          reason: "host_key_changed",
          details: { fingerprint: key.fingerprint, key_type: key.type },
        });
      return run();
    };
    return {
      list: (path, query) => guard(() => source.list(path, query)),
      stat: (path) => guard(() => source.stat(path)),
      read: (path) => guard(() => source.read(path)),
      put: (path, body) => guard(() => source.put(path, body)),
      remove: (path) => guard(() => source.remove(path)),
      close: () => source.close(),
    };
  };
}

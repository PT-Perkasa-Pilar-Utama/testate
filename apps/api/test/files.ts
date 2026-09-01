import type { AdapterDraft } from "@testate/shared";
import * as v from "valibot";

import { createMemorySource } from "../src/lib/files/index.ts";
import type { MemoryTree } from "../src/lib/files/index.ts";
import type { OpenFileSource } from "../src/lib/files/open.ts";
import { AppError } from "../src/lib/http/index.ts";
import type { FilesResolver } from "../src/modules/adapters/adapters.files.ts";

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

/**
 * A resolver whose source suspends before it answers and refuses anything still outstanding once
 * it is closed.
 *
 * The memory driver every storage test runs on has a `close()` that does nothing and a `stat()`
 * that answers inside one tick, so a call left in flight across a close can never be observed
 * through it. A real SFTP close ends the transport and a real FTP close drops the control
 * connection, and this is the smallest double that behaves that way.
 */
export function closesHard(files: FilesResolver): FilesResolver {
  return {
    resolve: async (projectId, adapterId, trustAs) => {
      const opened = await files.resolve(projectId, adapterId, trustAs);
      let shut = false;
      const refuseWhenShut = async (): Promise<void> => {
        await Promise.resolve();
        if (shut) throw new Error("the connection was closed under this call");
      };
      return {
        ...opened,
        source: {
          ...opened.source,
          stat: async (path) => {
            await refuseWhenShut();
            return opened.source.stat(path);
          },
          close: async () => {
            shut = true;
            await opened.source.close();
          },
        },
      };
    },
  };
}

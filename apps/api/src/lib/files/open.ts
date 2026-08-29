import type { Engine, JsonObject } from "@testate/shared";
import * as v from "valibot";

import { fileHostConfigSchema, s3ConfigSchema } from "../../modules/adapters/adapters.config.ts";
import { AppError } from "../http/index.ts";
import { createFtpSource } from "./ftp.ts";
import type { FileSource, HostKeyVerifier } from "./index.ts";
import { createS3Source } from "./s3.ts";
import { createSftpSource } from "./sftp.ts";
import type { SftpSourceConfig } from "./sftp.ts";

export type FileSecrets = Record<string, string>;

/** Builds the driver for a storage engine from its validated public config and opened secrets. */
export type OpenFileSource = (
  engine: Engine,
  config: JsonObject,
  secrets: FileSecrets,
  verifyHostKey: HostKeyVerifier
) => FileSource;

const DEFAULT_PORT = { sftp: 22, ftp: 21 } as const;

function required(secrets: FileSecrets, key: string, engine: Engine): string {
  const value = secrets[key];
  if (value === undefined)
    throw new AppError("VALIDATION_ERROR", `${engine} needs the ${key} secret`, { key });
  return value;
}

export const openFileSource: OpenFileSource = (engine, config, secrets, verifyHostKey) => {
  switch (engine) {
    case "s3": {
      const parsed = v.parse(s3ConfigSchema, config);
      const source = {
        bucket: parsed.bucket,
        prefix: parsed.prefix,
        region: parsed.region,
        virtual_hosted: parsed.virtual_hosted,
        accessKeyId: required(secrets, "access_key_id", engine),
        secretAccessKey: required(secrets, "secret_access_key", engine),
      };
      return createS3Source(
        parsed.endpoint === undefined ? source : { ...source, endpoint: parsed.endpoint }
      );
    }
    case "sftp": {
      const parsed = v.parse(fileHostConfigSchema, config);
      const source: SftpSourceConfig = {
        host: parsed.host,
        port: parsed.port ?? DEFAULT_PORT.sftp,
        user: parsed.user,
        root_path: parsed.root_path,
        verifyHostKey,
      };
      const password = secrets["password"];
      const privateKey = secrets["private_key"];
      const passphrase = secrets["passphrase"];
      if (password !== undefined) source.password = password;
      if (privateKey !== undefined) source.privateKey = privateKey;
      if (passphrase !== undefined) source.passphrase = passphrase;
      return createSftpSource(source);
    }
    case "ftp": {
      const parsed = v.parse(fileHostConfigSchema, config);
      return createFtpSource({
        host: parsed.host,
        port: parsed.port ?? DEFAULT_PORT.ftp,
        user: parsed.user,
        password: required(secrets, "password", engine),
        root_path: parsed.root_path,
        tls: parsed.tls,
      });
    }
    default:
      throw new AppError("ENGINE_UNSUPPORTED", `${engine} is not a storage engine`, {
        reason: "tier",
      });
  }
};

import type { Engine, JsonObject } from "@testate/shared";
import * as v from "valibot";

import { fileHostConfigSchema, s3ConfigSchema } from "../../modules/adapters/adapters.config.ts";
import { AppError } from "../http/index.ts";
import { createFtpSource } from "./ftp.ts";
import type { FtpSourceConfig } from "./ftp.ts";
import type { FileSource, HostKeyVerifier } from "./index.ts";
import { createS3Source } from "./s3.ts";
import { createSftpSource } from "./sftp.ts";
import type { SftpSourceConfig } from "./sftp.ts";
import type { S3SourceConfig } from "./s3.ts";
import type { CheckedTarget } from "../netguard/index.ts";

export type FileSecrets = Record<string, string>;

/** Builds the driver for a storage engine from its validated public config and opened secrets. */
export type OpenFileSource = (
  engine: Engine,
  config: JsonObject,
  secrets: FileSecrets,
  verifyHostKey: HostKeyVerifier,
  target?: CheckedTarget
) => FileSource;

const DEFAULT_PORT = { sftp: 22, ftp: 21 } as const;

function required(secrets: FileSecrets, key: string, engine: Engine): string {
  const value = secrets[key];
  if (value === undefined)
    throw new AppError("VALIDATION_ERROR", `${engine} needs the ${key} secret`, { key });
  return value;
}

function openS3(config: JsonObject, secrets: FileSecrets, target?: CheckedTarget): FileSource {
  const parsed = v.parse(s3ConfigSchema, config);
  const source: S3SourceConfig = {
    bucket: parsed.bucket,
    prefix: parsed.prefix,
    region: parsed.region,
    virtual_hosted: parsed.virtual_hosted,
    accessKeyId: required(secrets, "access_key_id", "s3"),
    secretAccessKey: required(secrets, "secret_access_key", "s3"),
  };
  if (parsed.endpoint !== undefined) source.endpoint = parsed.endpoint;
  if (target !== undefined) {
    source.address = target.address;
    source.port = target.port;
  }
  return createS3Source(source);
}

function openSftp(
  config: JsonObject,
  secrets: FileSecrets,
  verifyHostKey: HostKeyVerifier,
  target?: CheckedTarget
): FileSource {
  const parsed = v.parse(fileHostConfigSchema, config);
  const source: SftpSourceConfig = {
    host: parsed.host,
    port: parsed.port ?? DEFAULT_PORT.sftp,
    user: parsed.user,
    root_path: parsed.root_path,
    verifyHostKey,
  };
  if (target !== undefined) source.address = target.address;
  const password = secrets["password"];
  const privateKey = secrets["private_key"];
  const passphrase = secrets["passphrase"];
  if (password !== undefined) source.password = password;
  if (privateKey !== undefined) source.privateKey = privateKey;
  if (passphrase !== undefined) source.passphrase = passphrase;
  return createSftpSource(source);
}

function openFtp(config: JsonObject, secrets: FileSecrets, target?: CheckedTarget): FileSource {
  const parsed = v.parse(fileHostConfigSchema, config);
  const source: FtpSourceConfig = {
    host: parsed.host,
    port: parsed.port ?? DEFAULT_PORT.ftp,
    user: parsed.user,
    password: required(secrets, "password", "ftp"),
    root_path: parsed.root_path,
    tls: parsed.tls,
  };
  if (target !== undefined) source.address = target.address;
  return createFtpSource(source);
}

export const openFileSource: OpenFileSource = (engine, config, secrets, verifyHostKey, target) => {
  switch (engine) {
    case "s3":
      return openS3(config, secrets, target);
    case "sftp":
      return openSftp(config, secrets, verifyHostKey, target);
    case "ftp":
      return openFtp(config, secrets, target);
    default:
      throw new AppError("ENGINE_UNSUPPORTED", `${engine} is not a storage engine`, {
        reason: "tier",
      });
  }
};

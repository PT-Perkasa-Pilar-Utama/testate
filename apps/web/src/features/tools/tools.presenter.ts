import { createSignal } from "solid-js";
import type { JsonObject } from "@testate/shared";

import { attempt } from "@/components/toast.tsx";
import { toolsModel } from "./tools.model.ts";

export const ALGORITHMS = ["argon2id", "bcrypt", "sha256", "sha512", "hmac_sha256"] as const;
export type Algorithm = (typeof ALGORITHMS)[number];
export const ENCODINGS = ["base64url", "base64", "hex"] as const;
export type Encoding = (typeof ENCODINGS)[number];

export type ToolsPresenter = {
  algorithm: () => Algorithm;
  value: () => string;
  secret: () => string;
  hash: () => string | null;
  setAlgorithm: (value: Algorithm) => void;
  setValue: (value: string) => void;
  setSecret: (value: string) => void;
  runHash: () => Promise<void>;
  bytes: () => number;
  encoding: () => Encoding;
  random: () => string | null;
  setBytes: (value: number) => void;
  setEncoding: (value: Encoding) => void;
  runRandom: () => Promise<void>;
  uuids: () => string[];
  runUuid: (count: number) => Promise<void>;
};

/** Builds the hash body; `secret` doubles as the HMAC key and as the seed for the others. */
export function hashBody(algorithm: Algorithm, value: string, secret: string): JsonObject {
  const body: JsonObject = { algorithm, value };
  if (secret !== "") body["secret"] = secret;
  return body;
}

export function createToolsPresenter(): ToolsPresenter {
  const [algorithm, setAlgorithm] = createSignal<Algorithm>("bcrypt");
  const [value, setValue] = createSignal("");
  const [secret, setSecret] = createSignal("");
  const [hash, setHash] = createSignal<string | null>(null);
  const [bytes, setBytes] = createSignal(32);
  const [encoding, setEncoding] = createSignal<Encoding>("base64url");
  const [random, setRandom] = createSignal<string | null>(null);
  const [uuids, setUuids] = createSignal<string[]>([]);
  return {
    algorithm,
    value,
    secret,
    hash,
    setAlgorithm,
    setValue,
    setSecret,
    runHash: () =>
      attempt(async () => {
        const result = await toolsModel.hash(hashBody(algorithm(), value(), secret()));
        setHash(result.hash);
      }),
    bytes,
    encoding,
    random,
    setBytes,
    setEncoding,
    runRandom: () =>
      attempt(async () => {
        const result = await toolsModel.random({ bytes: bytes(), encoding: encoding() });
        setRandom(result.value);
      }),
    uuids,
    runUuid: (count) =>
      attempt(async () => {
        const result = await toolsModel.uuid({ version: 7, count });
        setUuids(result.values);
      }),
  };
}

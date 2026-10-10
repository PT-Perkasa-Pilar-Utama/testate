import { describe, expect, it } from "bun:test";

import { createMasker, maskEntry } from "./mask.ts";

// Q5: what a viewer and an agent never see in a log line.
const mask = createMasker([]);
const hidden = (text: string): string => mask(text).text;

describe("masking log lines", () => {
  it("hides each built-in kind of secret and keeps the label beside it", () => {
    expect([
      hidden("Authorization: Bearer abcdef0123456789"),
      hidden('{"user":"tina","password":"hunter2-long"}'),
      hidden("login password=hunter2 ok"),
      hidden("token eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4f"),
      hidden("key AKIAIOSFODNN7EXAMPLE used"),
      hidden("db postgres://app:s3cret@db:5432/shop"),
      hidden("-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----"),
    ]).toEqual([
      "Authorization: Bearer ***",
      '{"user":"tina","password":"***"}',
      "login password=*** ok",
      "token ***",
      "key *** used",
      "db postgres://app:***@db:5432/shop",
      "***",
    ]);
  });

  it("leaves an ordinary line alone and says nothing was hidden", () => {
    expect(mask("GET /orders 200 in 12 ms")).toEqual({
      text: "GET /orders 200 in 12 ms",
      masked: false,
    });
  });

  it("masks a field named like a secret whatever it holds, and nested strings too", () => {
    const entry = maskEntry(
      "login",
      { password: 1234, user: { note: "token=abc123" }, ok: true },
      mask
    );
    expect(entry).toEqual({
      message: "login",
      fields: { password: "***", user: { note: "token=***" }, ok: true },
      masked: true,
    });
  });

  it("adds an adapter's own patterns to the built-in ones", () => {
    expect(createMasker(["ORD-\\d{6}"])("refund for ORD-123456").text).toBe("refund for ***");
  });
});
